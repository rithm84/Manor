-- The counter row serializes account changes until commit; sequences alone can skip late commits.
create table manor_private.workspace_change_heads (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cursor bigint not null check(cursor>=0)
);
create table manor_private.workspace_changes (
 user_id uuid not null references auth.users(id) on delete cascade,
 cursor bigint not null, object_type text not null, object_key jsonb not null,
 change text not null check(change in ('insert','update','delete','purge')),
 revision bigint, occurred_at timestamptz not null default clock_timestamp(),
 primary key(user_id,cursor)
);
alter table manor_private.workspace_change_heads enable row level security;
alter table manor_private.workspace_changes enable row level security;
revoke all on manor_private.workspace_change_heads,manor_private.workspace_changes from public,anon,authenticated;
grant select on manor_private.workspace_change_heads,manor_private.workspace_changes to manor_commands;
create policy workspace_heads_owner on manor_private.workspace_change_heads to manor_commands using(user_id=auth.uid());
create policy workspace_changes_owner on manor_private.workspace_changes to manor_commands using(user_id=auth.uid());

-- Only installed table triggers invoke this writer. No content is retained in the feed.
create function manor_private.record_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; owner_id uuid; next_cursor bigint; identity_fields jsonb;
begin
 if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 owner_id:=(r->>'user_id')::uuid;
 -- Account cascades must not recreate a head after the owner was deleted.
 if not exists(select 1 from auth.users where id=owner_id) then return coalesce(new,old); end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into identity_fields from jsonb_each(r)
 where key in ('id','habit_id','date','account_id','calendar_id','note_id','revision','object_type','object_id','provider','month');
 insert into manor_private.workspace_change_heads(user_id,cursor) values(owner_id,1)
 on conflict(user_id) do update set cursor=manor_private.workspace_change_heads.cursor+1 returning cursor into next_cursor;
 insert into manor_private.workspace_changes(user_id,cursor,object_type,object_key,change,revision)
 values(owner_id,next_cursor,tg_table_name,identity_fields,case when tg_table_name='purge_tombstones' then 'purge' else lower(tg_op) end,(r->>'revision')::bigint);
 return coalesce(new,old);
end $$;
revoke all on function manor_private.record_workspace_change() from public,anon,authenticated,manor_commands;
do $$ declare t text; begin
 foreach t in array array['profiles','contexts','tasks','scratch_blocks','saved_task_views','habits','habit_lifecycle','habit_entries','habit_freeze_intents','mood_focus_entries','leetcode_attempts','leetcode_notes','leetcode_freeze_intents','job_roles','note_folders','note_pages','note_attachments','kb_entries','resumes','note_versions','note_suggestions','weekly_reviews','task_series','file_objects','calendar_accounts','calendars','calendar_events'] loop
  execute format('create trigger manor_workspace_changes after insert or update or delete on public.%I for each row execute function manor_private.record_workspace_change()',t);
 end loop;
 create trigger manor_workspace_changes after insert or update on manor_private.purge_tombstones for each row execute function manor_private.record_workspace_change();
 create trigger manor_workspace_changes after insert or update or delete on manor_private.integration_jobs for each row execute function manor_private.record_workspace_change();
end $$;

-- Private job/connection reads use the command role's account-scoped RLS.
grant select on manor_private.integration_jobs to manor_commands;
grant update(run_after,last_error) on manor_private.integration_jobs to manor_commands;
grant select(user_id,provider,account_id,username,connected_at) on manor_private.integration_credentials to manor_commands;
create policy workspace_job_owner on manor_private.integration_jobs to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy workspace_connection_owner on manor_private.integration_credentials for select to manor_commands using(user_id=auth.uid());
grant select on public.calendar_events,public.calendar_accounts,public.calendars to manor_commands;
create policy workspace_calendar_events_owner on public.calendar_events for select to manor_commands using(user_id=auth.uid());
create policy workspace_calendar_accounts_owner on public.calendar_accounts for select to manor_commands using(user_id=auth.uid());
create policy workspace_calendars_owner on public.calendars for select to manor_commands using(user_id=auth.uid());

create function public.manor_workspace_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 account public.profiles; local_today date; first_day date; last_day date;
 row_limit integer:=coalesce((p_input->>'limit')::integer,50);
 cursor_value text:=coalesce(p_input->>'cursor',''); rows_json jsonb; result jsonb;
 head bigint; supplied_cursor bigint; job manor_private.integration_jobs;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(false) then raise exception using errcode='42501',message='This agent is not authorized to read'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>10000 or row_limit not between 1 and 200 then raise exception using errcode='22023',message='Workspace queries require bounded object input and a limit from 1 to 200'; end if;
 select * into account from public.profiles where user_id=auth.uid();
 local_today:=(now() at time zone account.timezone)::date;
 if p_query in ('get_workspace_context','get_preferences') then
  result:=jsonb_build_object('name',account.name,'timezone',account.timezone,'revision',account.revision,'today',local_today,'onboarding_required',account.timezone is null);
  if p_query='get_preferences' then return result; end if;
  return result||jsonb_build_object('capability_version','2026-09-11','change_cursor',coalesce((select cursor from manor_private.workspace_change_heads where user_id=auth.uid()),0)::text,
   'access',jsonb_build_object('read',true,'write',auth.jwt()->>'client_id' is null or manor_private.mcp_allowed(true)),
   'restrictions',jsonb_build_object('journal','unavailable','calendar','read_only','live_browser_context','unavailable','unsaved_drafts','unavailable','changes_begin','feed_installation','note_interchange','block_json_only','bookmark_preview_refresh','unavailable'));
 elsif p_query='get_operation_status' then
  if p_input->>'command_id' is null then raise exception 'A command ID is required'; end if;
  select jsonb_build_object('command_id',command_id,'operation',operation,'committed_at',created_at,'status',case when response->>'purged'='true' then 'result_purged' else 'committed' end) into result
  from manor_private.command_receipts where user_id=auth.uid() and command_id=(p_input->>'command_id')::uuid;
  return coalesce(result,jsonb_build_object('command_id',p_input->>'command_id','status','not_recorded'));
 elsif p_query='get_changes_since' then
  if p_input->>'cursor' is null or p_input->>'cursor' !~ '^[0-9]+$' then raise exception 'A nonnegative account cursor is required'; end if;
  supplied_cursor:=(p_input->>'cursor')::bigint;
  select coalesce((select cursor from manor_private.workspace_change_heads where user_id=auth.uid()),0) into head;
  if supplied_cursor>head then raise exception 'Cursor is ahead of this account; start from its workspace context'; end if;
  select coalesce(jsonb_agg(to_jsonb(c)-'user_id' order by cursor),'[]') into rows_json from
   (select * from manor_private.workspace_changes where user_id=auth.uid() and cursor>supplied_cursor and cursor<=head order by cursor limit row_limit) c;
  return jsonb_build_object('items',rows_json,'next_cursor',coalesce(rows_json->-1->>'cursor',supplied_cursor::text),'head_cursor',head::text,'has_more',coalesce((rows_json->-1->>'cursor')::bigint,supplied_cursor)<head);
 elsif p_query='get_background_run' then
  if p_input->>'provider' is null or p_input->>'provider' not in ('google','x') or p_input->>'account_id' is null then raise exception 'Choose a Google or X account'; end if;
  select * into job from manor_private.integration_jobs where user_id=auth.uid() and provider=p_input->>'provider' and account_id=p_input->>'account_id';
  if not found then raise exception using errcode='P0002',message='Synchronization job is unavailable'; end if;
  return jsonb_build_object('provider',job.provider,'account_id',job.account_id,'scheduled_at',job.run_after,'leased_until',job.leased_until,'attempts',job.attempts,
   'status',case when job.leased_until>now() then 'running' when job.last_error is not null then 'failed' else 'scheduled' end,
   'retry_eligible',job.last_error is not null and (job.leased_until is null or job.leased_until<=now()) and exists(select 1 from manor_private.integration_credentials c where c.user_id=auth.uid() and c.provider=job.provider and c.account_id=job.account_id));
 elsif p_query='get_application_history' then
  if p_input->>'application_id' is null then raise exception 'An application ID is required'; end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(t.at,t.id)::text cursor,t.id,t.role_id application_id,t.from_stage,t.to_stage,t.at
   from public.job_stage_transitions t where t.user_id=auth.uid() and t.role_id=p_input->>'application_id'
    and (not p_input?'from' or t.at>=(p_input->>'from')::timestamptz) and (not p_input?'to' or t.at<(p_input->>'to')::timestamptz)
    and jsonb_build_array(t.at,t.id)::text>cursor_value order by cursor limit row_limit
  ) h;
 elsif p_query='list_trash' then
  if p_input?'module' and p_input->>'module' not in ('tasks','applications','notes') then raise exception 'Trash module must be tasks, applications, or notes'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(module,id)::text cursor,items.*,deleted_at+interval '7 days' purge_eligible_at,deleted_at>now()-interval '7 days' recoverable from (
    select 'tasks' module,id,title,revision,deleted_at,null::text parent_page_id,null::text trash_root_id from public.tasks where user_id=auth.uid() and deleted_at is not null
    union all select 'applications',id,company||' · '||role,revision,deleted_at,null::text,null::text from public.job_roles where user_id=auth.uid() and deleted_at is not null
    union all select 'notes',id,title,revision,deleted_at,parent_page_id,trash_root_id from public.note_pages where user_id=auth.uid() and status='trash'
   ) items where (not p_input?'module' or module=p_input->>'module') and jsonb_build_array(module,id)::text>cursor_value order by cursor limit row_limit
  ) t;
 elsif p_query='get_integration_status' then
  select coalesce(jsonb_agg(to_jsonb(c) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(c.provider,c.account_id)::text cursor,c.provider,c.account_id,c.username,c.connected_at,j.run_after scheduled_at,j.leased_until,j.attempts,
    case when j.provider is null then 'not_scheduled' when j.leased_until>now() then 'running' when j.last_error is not null then 'failed' else 'scheduled' end status
   from manor_private.integration_credentials c left join manor_private.integration_jobs j using(user_id,provider,account_id)
   where c.user_id=auth.uid() and jsonb_build_array(c.provider,c.account_id)::text>cursor_value order by cursor limit row_limit
  ) c;
 else
  if local_today is null then raise exception 'Save an account timezone before querying dated records'; end if;
  if p_query in ('query_calendar_events','query_habit_history','get_metrics') then
   first_day:=(p_input->>'from')::date; last_day:=(p_input->>'to')::date;
   if first_day is null or last_day is null or last_day<first_day or last_day-first_day>365 then raise exception 'Choose an inclusive date range of 1 to 366 days'; end if;
  end if;
  if p_query='query_calendar_events' then
   select coalesce(jsonb_agg(to_jsonb(e) order by cursor),'[]') into rows_json from (
    select jsonb_build_array(e.account_id,e.calendar_id,e.id)::text cursor,e.id,e.account_id,e.calendar_id,e.title,e.starts_at,e.ends_at,e.start_date,e.end_date,e.all_day
    from public.calendar_events e join public.calendars c on c.user_id=e.user_id and c.account_id=e.account_id and c.id=e.calendar_id
    where e.user_id=auth.uid() and c.enabled and (not p_input?'account_id' or e.account_id=p_input->>'account_id') and (not p_input?'calendar_id' or e.calendar_id=p_input->>'calendar_id')
     and jsonb_build_array(e.account_id,e.calendar_id,e.id)::text>cursor_value
     and case when e.all_day then e.start_date<=last_day and e.end_date>first_day
      else e.starts_at<((last_day+1)::timestamp at time zone account.timezone) and e.ends_at>=(first_day::timestamp at time zone account.timezone) end
    order by cursor limit row_limit
   ) e;
  elsif p_query='query_habits' then
   first_day:=coalesce((p_input->>'date')::date,local_today);
   if first_day>local_today then raise exception 'Habit status cannot be queried for a future date'; end if;
   select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') into rows_json from (select * from (
    select h.id,h.name,h.kind,h.target_label,h.created_on,h.revision,h.position,
     coalesce((select l.status from public.habit_lifecycle l where l.user_id=auth.uid() and l.habit_id=h.id and l.date<=first_day order by l.date desc limit 1),'active') status
    from public.habits h where h.user_id=auth.uid() and h.created_on<=first_day and h.id>cursor_value
   ) matched where (not p_input?'status' or matched.status=p_input->>'status') order by id limit row_limit) h;
  elsif p_query='query_habit_history' then
   select coalesce(jsonb_agg(to_jsonb(h) order by cursor),'[]') into rows_json from (
    select jsonb_build_array(d.tracked_date::date,h.id)::text cursor,h.id habit_id,d.tracked_date::date as date,e.value,coalesce(e.revision,0) entry_revision,(e.value is null) missing
    from public.habits h cross join generate_series(first_day::timestamp,least(last_day,local_today)::timestamp,interval '1 day') d(tracked_date)
    left join public.habit_entries e on e.user_id=h.user_id and e.habit_id=h.id and e.date=d.tracked_date::date
    where h.user_id=auth.uid() and h.created_on<=d.tracked_date::date and (not p_input?'habit_id' or h.id=p_input->>'habit_id')
     and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date::date order by l.date desc limit 1),'active')='active'
     and jsonb_build_array(d.tracked_date::date,h.id)::text>cursor_value order by cursor limit row_limit
   ) h;
  elsif p_query='get_metrics' then
   if p_input->>'group_by' is null or p_input->>'group_by' not in ('total','day') then raise exception 'Metric grouping must be total or day'; end if;
   with days as (select generate_series(first_day::timestamp,least(last_day,local_today)::timestamp,interval '1 day')::date as tracked_date), daily as (
    select d.tracked_date,
     (select count(*) from public.tasks t where t.user_id=auth.uid() and t.deleted_at is null and t.completed_at>=(d.tracked_date::timestamp at time zone account.timezone) and t.completed_at<((d.tracked_date+1)::timestamp at time zone account.timezone)) tasks_completed,
     (select count(*) from public.habits h where h.user_id=auth.uid() and h.created_on<=d.tracked_date and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date order by l.date desc limit 1),'active')='active') habit_eligible_days,
     (select count(*) from public.habits h join public.habit_entries e on e.user_id=h.user_id and e.habit_id=h.id and e.date=d.tracked_date and e.value=100 where h.user_id=auth.uid() and h.created_on<=d.tracked_date and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date order by l.date desc limit 1),'active')='active') habits_completed,
     m.mood,m.focus from days d left join public.mood_focus_entries m on m.user_id=auth.uid() and m.date=d.tracked_date
   )
   select jsonb_build_object('from',first_day,'to',last_day,'timezone',account.timezone,'observed_days',count(*),
    'tasks_completed',coalesce(sum(tasks_completed),0),'habit_eligible_days',coalesce(sum(habit_eligible_days),0),'habits_completed',coalesce(sum(habits_completed),0),
    'habit_completion_rate',sum(habits_completed)::numeric/nullif(sum(habit_eligible_days),0),
    'mood_samples',count(mood),'mood_missing',count(*)-count(mood),'focus_samples',count(focus),'focus_missing',count(*)-count(focus),
    'mood_distribution',(select coalesce(jsonb_object_agg(mood,n),'{}') from (select mood,count(*) n from daily where mood is not null group by mood) m),
    'focus_distribution',(select coalesce(jsonb_object_agg(focus,n),'{}') from (select focus,count(*) n from daily where focus is not null group by focus) f),
    'days',case when p_input->>'group_by'='day' then coalesce(jsonb_agg(to_jsonb(daily) order by tracked_date),'[]') else null end,
    'membership','Task counts use retained non-trashed records with completed_at in each local day; reopening or purge removes that record from these counts. Habit denominator includes active days since creation through today. Resting is a Focus sample; future days are excluded.') into result from daily;
   return result;
  elsif p_query='get_day_overview' then
   first_day:=(p_input->>'date')::date;
   if first_day is null then raise exception 'Choose a date'; end if;
   select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows_json from (select id,title,status,due,context_id,priority,revision from public.tasks where user_id=auth.uid() and due=first_day and deleted_at is null and skipped_at is null and superseded_at is null order by id limit row_limit) t;
   result:=jsonb_build_object('date',first_day,'timezone',account.timezone,'tasks',jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then rows_json->-1->>'id' end));
   select coalesce(jsonb_agg(to_jsonb(s)-'user_id' order by id),'[]') into rows_json from (select * from public.scratch_blocks where user_id=auth.uid() and date=first_day and expires_at>now() order by id limit row_limit) s;
   result:=result||jsonb_build_object('scratch_blocks',jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then rows_json->-1->>'id' end),
    'calendar',public.manor_workspace_query('query_calendar_events',jsonb_build_object('from',first_day,'to',first_day,'limit',row_limit)),
    'daily_record',(select to_jsonb(m)-'user_id' from public.mood_focus_entries m where user_id=auth.uid() and date=first_day));
   if first_day<=local_today then result:=result||jsonb_build_object('metrics',public.manor_workspace_query('get_metrics',jsonb_build_object('from',first_day,'to',first_day,'group_by','total'))); end if;
   return result;
  else raise exception using errcode='22023',message='Unsupported workspace query: '||p_query;
  end if;
 end if;
 return jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then coalesce(rows_json->-1->>'cursor',rows_json->-1->>'id') end);
end $$;
grant create on schema public to manor_commands;
alter function public.manor_workspace_query(text,jsonb) owner to manor_commands;
revoke create on schema public from manor_commands;
revoke all on function public.manor_workspace_query(text,jsonb) from public,anon;
grant execute on function public.manor_workspace_query(text,jsonb) to authenticated;

create function manor_private.workspace_tool_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare account public.profiles; job manor_private.integration_jobs;
begin
 if auth.uid() is null or (auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(true)) then raise exception using errcode='42501',message='This account is not authorized to write'; end if;
 if op='update_preferences' then
  if exists(select 1 from jsonb_object_keys(p) k where k not in ('name','timezone','expected_revision')) or not (p?'name' or p?'timezone') then raise exception 'Update display name or timezone only, with the current profile revision'; end if;
  select * into account from public.profiles where user_id=auth.uid() for update;
  if not found then raise exception 'Finish account setup before editing preferences'; end if;
  perform manor_private.require_revision(account.revision,(p->>'expected_revision')::bigint,jsonb_build_object('name',account.name,'timezone',account.timezone,'revision',account.revision));
  if p?'name' and (jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120) then raise exception 'Display name must contain 1 to 120 characters'; end if;
  if p?'timezone' and not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown account timezone'; end if;
  if coalesce(p->>'name',account.name) is distinct from account.name or coalesce(p->>'timezone',account.timezone) is distinct from account.timezone then
   update public.profiles set name=coalesce(p->>'name',name),timezone=coalesce(p->>'timezone',timezone),revision=revision+1 where user_id=auth.uid() returning * into account;
  end if;
  return jsonb_build_object('name',account.name,'timezone',account.timezone,'revision',account.revision);
 elsif op='retry_background_run' then
  if p->>'provider' is null or p->>'provider' not in ('google','x') or p->>'account_id' is null then raise exception 'Choose a Google or X synchronization job'; end if;
  select * into job from manor_private.integration_jobs where user_id=auth.uid() and provider=p->>'provider' and account_id=p->>'account_id' for update;
  if not found then raise exception using errcode='P0002',message='Synchronization job is unavailable'; end if;
  if job.last_error is null or job.leased_until>now() then raise exception using errcode='55000',message='Only a failed synchronization job without an active lease can be retried'; end if;
  if not exists(select 1 from manor_private.integration_credentials c where c.user_id=auth.uid() and c.provider=job.provider and c.account_id=job.account_id) then raise exception 'Reconnect this account before retrying synchronization'; end if;
  update manor_private.integration_jobs set run_after=now(),last_error=null where user_id=auth.uid() and provider=job.provider and account_id=job.account_id;
  insert into public.action_events(user_id,command_id,actor,operation,object_type,object_id,changes)
  values(auth.uid(),current_setting('manor.command_id')::uuid,current_setting('manor.actor'),op,'integration_jobs',job.account_id,jsonb_build_object('provider',job.provider,'status',jsonb_build_object('before','failed','after','scheduled')));
  return jsonb_build_object('provider',job.provider,'account_id',job.account_id,'status','scheduled','scheduled_at',now());
 else raise exception 'Unsupported workspace command: %',op;
 end if;
end $$;
grant create on schema manor_private to manor_commands;
alter function manor_private.workspace_tool_command(text,jsonb) owner to manor_commands;
revoke create on schema manor_private from manor_commands;
revoke all on function manor_private.workspace_tool_command(text,jsonb) from public,anon,authenticated;
