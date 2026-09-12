grant create on schema manor_private to manor_commands;
create table public.task_series (
 id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 starts_on date not null, ends_before date, rule text not null,
 title text not null,context_id text not null,estimate_minutes int,priority text,tags text[] not null,
 revision bigint not null default 1,materialized_through date,
 foreign key(user_id,context_id) references public.contexts(user_id,id),unique(user_id,id)
);
alter table public.task_series enable row level security;
create policy series_read on public.task_series for select to authenticated using(user_id=auth.uid());
create policy series_command on public.task_series to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select on public.task_series to authenticated;
grant select,insert,update,delete on public.task_series to manor_commands;
alter table public.tasks add column series_id text,add column occurrence_date date,add column superseded_at timestamptz,
 add constraint task_series_owner foreign key(user_id,series_id) references public.task_series(user_id,id),
 add constraint task_series_occurrence unique(user_id,series_id,occurrence_date);
create trigger manor_history after insert or update or delete on public.task_series for each row execute function manor_private.record_change();

create function manor_private.rule_matches(rule text,anchor date,day date) returns boolean language plpgsql immutable set search_path='' as $$
declare token text; key text; value text; frequency text; every int:=1; weekdays text[]; until_day date; seen text[]:='{}'; delta int:=day-anchor;
begin
 if rule is null or length(rule)>300 then raise exception 'Provide a bounded RRULE'; end if;
 foreach token in array string_to_array(rule,';') loop
  key:=split_part(token,'=',1);value:=split_part(token,'=',2);
  if key=any(seen) then raise exception 'RRULE repeats field %',key; end if; seen:=array_append(seen,key);
  case key when 'FREQ' then frequency:=value;
  when 'INTERVAL' then every:=value::int;
  when 'BYDAY' then weekdays:=string_to_array(value,',');
  when 'UNTIL' then if value !~ '^[0-9]{8}(T235959Z)?$' then raise exception 'UNTIL requires YYYYMMDD'; end if; until_day:=to_date(left(value,8),'YYYYMMDD');
  else raise exception 'Unsupported recurrence field: %',key; end case;
 end loop;
 if frequency is null or frequency not in ('DAILY','WEEKLY','MONTHLY') or every not between 1 and 365 then raise exception 'Recurrence supports DAILY, WEEKLY, MONTHLY with interval 1 to 365'; end if;
 if weekdays is not null and (frequency<>'WEEKLY' or exists(select 1 from unnest(weekdays) d where d not in ('MO','TU','WE','TH','FR','SA','SU'))) then raise exception 'BYDAY requires weekly recurrence and standard weekday codes'; end if;
 if day<anchor or day>until_day then return false; end if;
 if frequency='DAILY' then return delta%every=0; end if;
 if frequency='WEEKLY' then return ((day-date_trunc('week',anchor)::date)/7)%every=0 and case when weekdays is null then extract(isodow from day)=extract(isodow from anchor) else (array['MO','TU','WE','TH','FR','SA','SU'])[extract(isodow from day)::int]=any(weekdays) end; end if;
 return ((extract(year from day)::int-extract(year from anchor)::int)*12+extract(month from day)::int-extract(month from anchor)::int)%every=0 and extract(day from day)=extract(day from anchor);
end $$;
revoke all on function manor_private.rule_matches(text,date,date) from public;
grant execute on function manor_private.rule_matches(text,date,date) to manor_commands;
create function manor_private.materialize_series(series_key text) returns void language plpgsql set search_path='' as $$
declare s public.task_series; day date; horizon date:=manor_private.today()+90; context_name text;
begin
 select * into s from public.task_series where id=series_key and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Recurrence series is unavailable'; end if;
 if s.starts_on<manor_private.today()-1826 then raise exception 'Recurrence catch-up exceeds five years; reconcile the older series explicitly'; end if;
 select name into context_name from public.contexts where user_id=auth.uid() and id=s.context_id;
 for day in select generate_series(coalesce(s.materialized_through+1,s.starts_on),least(horizon,coalesce(s.ends_before-1,horizon)),interval '1 day')::date loop
  if manor_private.rule_matches(s.rule,s.starts_on,day) then
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,tags,recurrence,series_id,occurrence_date)
   values(case when day=s.starts_on then s.id else gen_random_uuid()::text end,auth.uid(),s.title,context_name,s.context_id,s.estimate_minutes,s.priority,'Not started',day,s.tags,s.rule,s.id,day)
   on conflict(user_id,series_id,occurrence_date) do nothing;
  end if;
 end loop;
 update public.task_series set materialized_through=horizon where id=s.id and user_id=auth.uid();
end $$;
alter function manor_private.materialize_series(text) owner to manor_commands;
revoke all on function manor_private.materialize_series(text) from public;
create function manor_private.recurrence_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare t public.tasks; s public.task_series; series_key text:=p->>'id'; r jsonb;
begin
 if op='create_recurring_task' then
  if (p->>'expected_revision')::bigint<>0 then raise exception 'New recurring task requires revision zero'; end if;
  perform manor_private.rule_matches(p->>'recurrence',(p->>'due')::date,(p->>'due')::date);
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',p->>'title',p->>'context_id',(p->>'estimate_minutes')::int,p->>'priority',array(select jsonb_array_elements_text(p->'tags')));
  perform manor_private.materialize_series(series_key);
  select to_jsonb(tasks.*) into r from public.tasks where user_id=auth.uid() and series_id=series_key order by occurrence_date limit 1;
  if r is null then raise exception 'Recurrence does not produce an occurrence in the next 90 days'; end if;
 elsif op='convert_task_to_series' then
  select * into t from public.tasks where id=series_key and user_id=auth.uid() for update;
  perform manor_private.require_revision(t.revision,(p->>'expected_revision')::bigint,to_jsonb(t));
  if t.id is null or t.series_id is not null or t.deleted_at is not null then raise exception 'Choose an available standalone task'; end if;
  perform manor_private.rule_matches(p->>'recurrence',(p->>'due')::date,(p->>'due')::date);
  series_key:=p->>'new_series_id';
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',coalesce(p->>'title',t.title),coalesce(p->>'context_id',t.context_id),case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else t.estimate_minutes end,case when p?'priority' then p->>'priority' else t.priority end,case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else t.tags end);
  update public.tasks set series_id=series_key,occurrence_date=(p->>'due')::date,due=(p->>'due')::date,recurrence=p->>'recurrence',title=coalesce(p->>'title',title),context_id=coalesce(p->>'context_id',context_id),context=(select name from public.contexts where user_id=auth.uid() and id=coalesce(p->>'context_id',t.context_id)),estimate_minutes=case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else estimate_minutes end,priority=case when p?'priority' then p->>'priority' else priority end,tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,status=coalesce(p->>'status',status),completed_at=case when p->>'status'='Done' then now() when p?'status' then null else completed_at end,revision=revision+1,updated_at=now() where id=t.id and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  perform manor_private.materialize_series(series_key);
 elsif op='skip_task_occurrence' then
  select * into t from public.tasks where id=series_key and user_id=auth.uid() for update;
  perform manor_private.require_revision(t.revision,(p->>'expected_revision')::bigint,to_jsonb(t));
  if t.series_id is null or t.status='Done' or t.deleted_at is not null then raise exception 'Only an unfinished recurring occurrence can be skipped'; end if;
  update public.tasks set skipped_at=now(),revision=revision+1,updated_at=now() where id=t.id and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
 elsif op='update_future_task_occurrences' then
  select * into t from public.tasks where id=series_key and user_id=auth.uid() for update;
  perform manor_private.require_revision(t.revision,(p->>'expected_revision')::bigint,to_jsonb(t));
  if t.series_id is null or t.status='Done' or t.skipped_at is not null or t.occurrence_date<manor_private.today() then raise exception 'Choose a current or future unfinished occurrence to change the future series'; end if;
  select * into s from public.task_series where id=t.series_id and user_id=auth.uid() for update;
  if p->>'recurrence' is not null then perform manor_private.rule_matches(p->>'recurrence',(p->>'due')::date,(p->>'due')::date); end if;
  update public.task_series set ends_before=t.occurrence_date,revision=revision+1 where id=s.id and user_id=auth.uid();
  update public.tasks set superseded_at=now(),revision=revision+1 where user_id=auth.uid() and series_id=s.id and occurrence_date>=t.occurrence_date and status<>'Done' and skipped_at is null;
  if p->>'recurrence' is null then
   update public.tasks set superseded_at=null,series_id=null,occurrence_date=null,recurrence=null,due=(p->>'due')::date,title=coalesce(p->>'title',title),revision=revision+1,updated_at=now() where id=t.id and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
   return r;
  end if;
  series_key:=p->>'new_series_id';
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',coalesce(p->>'title',s.title),coalesce(p->>'context_id',s.context_id),case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else s.estimate_minutes end,case when p?'priority' then p->>'priority' else s.priority end,case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else s.tags end);
  perform manor_private.materialize_series(series_key);
  select to_jsonb(tasks.*) into r from public.tasks where user_id=auth.uid() and series_id=series_key order by occurrence_date limit 1;
 else raise exception 'Unsupported recurrence operation'; end if;
 return r;
end $$;
alter function manor_private.recurrence_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.recurrence_command(text,jsonb) from public;

create function public.manor_weekly_review_input(p_period_start timestamptz,p_period_end timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare tz text; start_day date; end_day date;
begin
 if auth.uid() is null then raise exception 'Sign in before reading review inputs'; end if;
 select timezone into tz from public.profiles where user_id=auth.uid();
 if tz is null or p_period_end>now() or (p_period_end at time zone tz)-(p_period_start at time zone tz)<>interval '7 days' then raise exception 'Provide a completed seven-day review period'; end if;
 start_day:=(p_period_start at time zone tz)::date; end_day:=(p_period_end at time zone tz)::date;
 if (select count(*) from public.action_events where user_id=auth.uid() and occurred_at>=p_period_start and occurred_at<p_period_end)>10000 then raise exception 'Review period exceeds 10000 history events; use paginated history input'; end if;
 return jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'timezone',tz,
 'input_watermark',(select coalesce(max(id),0) from public.action_events where user_id=auth.uid()),
 'daily_records',(select coalesce(jsonb_agg(to_jsonb(d.*) order by date),'[]') from public.mood_focus_entries d where user_id=auth.uid() and date between start_day and end_day),
 'habit_entries',(select coalesce(jsonb_agg(to_jsonb(e.*) order by date),'[]') from public.habit_entries e where user_id=auth.uid() and date between start_day and end_day),
 'habits',(select coalesce(jsonb_agg(to_jsonb(h.*)),'[]') from public.habits h where user_id=auth.uid()),
 'history',(select coalesce(jsonb_agg(to_jsonb(e.*) order by occurred_at,id),'[]') from public.action_events e where user_id=auth.uid() and occurred_at>=p_period_start and occurred_at<p_period_end and object_type in ('tasks','habits','habit_entries','habit_lifecycle','habit_freeze_intents','mood_focus_entries')));
end $$;
revoke all on function public.manor_weekly_review_input(timestamptz,timestamptz) from public,anon;
grant execute on function public.manor_weekly_review_input(timestamptz,timestamptz) to authenticated;

create function manor_private.extra_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare n public.note_pages; destination public.note_pages; listing public.job_listings; capture public.kb_entries; r jsonb; block jsonb; new_content jsonb; source_content jsonb; block_key text;
begin
 if op='add_job_listing' then
  select * into listing from public.job_listings where id=p->>'listing_id';
  if listing.id is null then raise exception 'Job listing is unavailable'; end if;
  return manor_private.domain_command('create_application',jsonb_build_object('id',gen_random_uuid()::text,'expected_revision',0,'company',listing.company,'role',listing.role,'location',listing.locations,'link',listing.url,'posted',listing.posted,'term',listing.term,'stage','to_apply'));
 elsif op='touch_note' then
  update public.note_pages set last_opened_at=now() where user_id=auth.uid() and id=p->>'id' and status<>'trash' returning to_jsonb(note_pages.*) into r;
  if r is null then raise exception 'Note is unavailable'; end if;
  return r;
 elsif op in ('move_note_block','move_note_blocks') then
  if op='move_note_blocks' then p:=p||jsonb_build_object('destination_id',p->>'target_note_id','destination_revision',p->'target_expected_revision'); end if;
  select * into n from public.note_pages where user_id=auth.uid() and id=p->>'id' and status<>'trash' for update;
  select * into destination from public.note_pages where user_id=auth.uid() and id=p->>'destination_id' and status<>'trash' for update;
  if n.id is null or destination.id is null or n.id=destination.id then raise exception 'Choose two available, distinct notes'; end if;
  perform manor_private.require_revision(n.revision,(p->>'expected_revision')::bigint,to_jsonb(n));
  perform manor_private.require_revision(destination.revision,(p->>'destination_revision')::bigint,to_jsonb(destination));
  source_content:=n.content_json; new_content:=destination.content_json;
  if op='move_note_block' then p:=p||jsonb_build_object('block_ids',jsonb_build_array(p->>'block_id')); end if;
  if jsonb_array_length(p->'block_ids') not between 1 and 50 then raise exception 'Move 1 to 50 blocks at a time'; end if;
  for block_key in select jsonb_array_elements_text(p->'block_ids') loop
   block:=manor_private.find_block(source_content,block_key);
   if block is null then raise exception 'Source block is unavailable or overlaps another selected block'; end if;
   source_content:=manor_private.replace_block(source_content,block_key,'null');
   new_content:=new_content||jsonb_build_array(block);
  end loop;
  perform manor_private.validate_blocks(new_content);
  insert into public.note_versions(user_id,note_id,revision,title,content_json) values(auth.uid(),n.id,n.revision,n.title,n.content_json),(auth.uid(),destination.id,destination.revision,destination.title,destination.content_json) on conflict do nothing;
  update public.note_pages set content_json=source_content,revision=revision+1,updated_at=now() where user_id=auth.uid() and id=n.id;
  update public.note_pages set content_json=new_content,revision=revision+1,updated_at=now() where user_id=auth.uid() and id=destination.id;
  select jsonb_build_object('source',to_jsonb(s.*),'destination',to_jsonb(d.*)) into r from public.note_pages s,public.note_pages d where s.id=n.id and d.id=destination.id and s.user_id=auth.uid() and d.user_id=auth.uid();
  return r;
 elsif op='remove_capture' then
  select * into capture from public.kb_entries where user_id=auth.uid() and id=(p->>'id')::uuid for update;
  perform manor_private.require_revision(capture.revision,(p->>'expected_revision')::bigint,to_jsonb(capture));
  if capture.id is null then raise exception 'Capture is unavailable'; end if;
  update public.kb_entries set deleted_at=now(),revision=revision+1 where user_id=auth.uid() and id=capture.id returning to_jsonb(kb_entries.*) into r;
  return r;
 else raise exception 'Unsupported extra operation'; end if;
end $$;
grant select on public.job_listings to manor_commands;
alter function manor_private.extra_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.extra_command(text,jsonb) from public;

-- A narrow privileged maintenance entrypoint; never exposed to browser roles.
-- File bytes are deleted by the file worker only after entering the purging state.
create function public.manor_purge_expired() returns integer language plpgsql security definer set search_path='' as $$
declare item record; total int:=0; review_key text;
begin
 for item in select 'tasks' as kind,id,user_id from public.tasks where deleted_at<=now()-interval '7 days'
 union all select 'job_roles',id,user_id from public.job_roles where deleted_at<=now()-interval '7 days'
 union all select 'note_pages',id,user_id from public.note_pages where deleted_at<=now()-interval '7 days' order by user_id,id limit 500 loop
  perform pg_advisory_xact_lock(hashtextextended(item.user_id::text,0));
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','purge_expired',true);
  insert into manor_private.purge_tombstones(user_id,object_type,object_id) values(item.user_id,item.kind,item.id) on conflict do nothing;
  for review_key in select review_id from manor_private.review_sources where user_id=item.user_id and object_type=item.kind and object_id=item.id loop
   delete from public.weekly_reviews where user_id=item.user_id and id=review_key;
   update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type='weekly_reviews' and object_id=review_key;
   update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response->'record'->>'id'=review_key;
  end loop;
  if item.kind='tasks' then
   delete from public.tasks where user_id=item.user_id and id=item.id;
  elsif item.kind='job_roles' then
   delete from public.job_roles where user_id=item.user_id and id=item.id;
  else
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='note' and parent_id=item.id;
   delete from public.note_pages where user_id=item.user_id and id=item.id;
  end if;
  update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and ((object_type=item.kind and object_id=item.id) or (object_type='scratch_blocks' and (changes->'task_id'->>'before'=item.id or changes->'task_id'->>'after'=item.id)) or (object_type='note_suggestions' and changes::text like '%'||item.id||'%'));
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response::text like '%'||to_jsonb(item.id)::text||'%';
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.manor_purge_expired() from public,anon,authenticated;
grant execute on function public.manor_purge_expired() to service_role;
