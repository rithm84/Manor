-- Additive web command boundary. Apply only after staging validation and cutover approval.
create schema manor_private;
revoke all on schema manor_private from public;
create role manor_commands nologin inherit;
grant authenticated to manor_commands;
grant manor_commands to postgres;
grant usage on schema public, auth, manor_private to manor_commands;
grant create on schema manor_private to manor_commands;
grant execute on function auth.uid(), auth.jwt() to manor_commands;
grant usage on schema manor_private to authenticated;

alter table profiles add column timezone text;
alter table profiles add column revision bigint not null default 1;
alter table tasks add column revision bigint not null default 1,
  add column deleted_at timestamptz, add column completed_at timestamptz,
  add column skipped_at timestamptz;
alter table contexts add column id text not null default gen_random_uuid()::text,
  add column revision bigint not null default 1,
  add constraint contexts_owner_id unique(user_id,id);
alter table tasks add column context_id text;
update tasks t set context_id=c.id from contexts c where c.user_id=t.user_id and c.name=t.context;
alter table tasks add constraint tasks_context_owner foreign key(user_id,context_id) references contexts(user_id,id);
alter table tasks add constraint tasks_owner_id unique(user_id,id);
alter table note_pages add column revision bigint not null default 1,
  add column trash_root_id text, add column pre_trash_status text,
  add constraint note_pages_owner_id unique(user_id,id);
alter table note_folders add column revision bigint not null default 1,
  add constraint note_folders_owner_id unique(user_id,id);
alter table note_pages add constraint note_pages_parent_owner foreign key(user_id,parent_page_id) references note_pages(user_id,id),
  add constraint note_pages_folder_owner foreign key(user_id,folder_id) references note_folders(user_id,id);
alter table note_folders add constraint note_folders_parent_owner foreign key(user_id,parent_folder_id) references note_folders(user_id,id);
alter table note_attachments add constraint note_attachments_parent_owner foreign key(user_id,note_id) references note_pages(user_id,id);
alter table job_roles add column revision bigint not null default 1, add column deleted_at timestamptz,
  add constraint job_roles_owner_id unique(user_id,id);
alter table job_stage_transitions add constraint job_stage_owner foreign key(user_id,role_id) references job_roles(user_id,id);
alter table habits add column revision bigint not null default 1,
  add constraint habits_owner_id unique(user_id,id);
alter table habit_entries add column revision bigint not null default 1,
  add constraint habit_entries_owner foreign key(user_id,habit_id) references habits(user_id,id);
alter table habit_lifecycle add constraint habit_lifecycle_owner_fk foreign key(user_id,habit_id) references habits(user_id,id);
alter table habit_freeze_intents add constraint habit_freeze_intents_owner foreign key(user_id,habit_id) references habits(user_id,id);
alter table mood_focus_entries add column revision bigint not null default 1;
alter table mood_focus_entries drop constraint mood_focus_entries_check;
alter table mood_focus_entries add constraint mood_focus_has_content check(mood is not null or focus is not null or note is not null);
alter table mood_focus_entries drop constraint mood_focus_entries_note_source_check;
alter table mood_focus_entries add constraint mood_focus_entries_note_source_check check(note_source in ('manual','alfred','codex'));
alter table scratch_blocks add column revision bigint not null default 1,
  add constraint scratch_blocks_owner_task foreign key(user_id,task_id) references tasks(user_id,id);
alter table saved_task_views add column revision bigint not null default 1;
alter table leetcode_attempts add column revision bigint not null default 1;
alter table leetcode_notes add column revision bigint not null default 1;
alter table kb_entries add column revision bigint not null default 1;

create table public.action_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 command_id uuid not null, occurred_at timestamptz not null default clock_timestamp(),
 actor text not null check(actor in ('user','codex','background')),
 operation text not null, object_type text not null, object_id text,
 changes jsonb not null, provenance jsonb, scrubbed_at timestamptz
);
create index action_events_owner_time on action_events(user_id,occurred_at desc,id desc);
create table manor_private.command_receipts (
 user_id uuid not null references auth.users(id) on delete cascade, command_id uuid not null,
 operation text not null, input_hash text not null, response jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(user_id,command_id)
);
create table public.note_versions (
 user_id uuid not null, note_id text not null, revision bigint not null,
 title text not null, content_json jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,note_id,revision), foreign key(user_id,note_id) references note_pages(user_id,id) on delete cascade
);
create table public.note_suggestions (
 id text primary key, user_id uuid not null, note_id text not null, base_revision bigint not null,
 block_id text not null, before_content_json jsonb not null, after_content_json jsonb not null,
 description text not null check(length(description) between 1 and 2000),
 status text not null check(status in ('pending','accepted','rejected')),
 revision bigint not null default 1, created_at timestamptz not null default clock_timestamp(), resolved_at timestamptz,
 foreign key(user_id,note_id) references note_pages(user_id,id) on delete cascade
);
create index note_suggestions_owner_note on note_suggestions(user_id,note_id,status);
create table public.weekly_reviews (
 id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 period_start timestamptz not null, period_end timestamptz not null,
 input_watermark bigint not null, content text not null check(length(content) between 1 and 100000),
 model text not null, revision bigint not null default 1, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), unique(user_id,period_start,period_end), check(period_end>period_start)
);
create table manor_private.purge_tombstones (
 user_id uuid not null, object_type text not null, object_id text not null,
 purged_at timestamptz not null default clock_timestamp(), primary key(user_id,object_type,object_id)
);

-- Browser roles get reads only. The command role has owner-scoped RLS and no login.
do $setup$
declare t text;
begin
 foreach t in array array['profiles','contexts','tasks','scratch_blocks','saved_task_views','habits','habit_lifecycle','habit_entries','habit_freeze_intents','habit_freeze_usage','habit_freeze_grants','habit_finalized_days','habit_month_pools','mood_focus_entries','leetcode_problems','leetcode_attempts','leetcode_notes','job_roles','job_stage_transitions','note_folders','note_pages','note_attachments','kb_entries','resumes','action_events','note_versions','note_suggestions','weekly_reviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to manor_commands',t);
  execute format('create policy manor_command_owner on public.%I for all to manor_commands using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
 end loop;
 foreach t in array array['action_events','note_versions','note_suggestions','weekly_reviews'] loop
  execute format('create policy manor_read_owner on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
 end loop;
end $setup$;
grant usage,select on sequence public.action_events_id_seq to manor_commands;
grant select,insert,update on manor_private.command_receipts to manor_commands;
grant select,insert on manor_private.purge_tombstones to manor_commands;
alter table manor_private.command_receipts enable row level security;
alter table manor_private.purge_tombstones enable row level security;
create policy receipts_owner on manor_private.command_receipts to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy tombstones_owner on manor_private.purge_tombstones to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());

create function manor_private.record_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare before_row jsonb; after_row jsonb; delta jsonb; object_key text; cmd uuid;
begin
 before_row := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 object_key := coalesce(after_row->>'id',before_row->>'id',after_row->>'habit_id',before_row->>'habit_id',after_row->>'date',before_row->>'date',after_row->>'user_id',before_row->>'user_id');
 select coalesce(jsonb_object_agg(k,jsonb_build_object('before',before_row->k,'after',after_row->k)),'{}') into delta
 from (select jsonb_object_keys(before_row||after_row) k) fields
 where k not in ('user_id','revision','updated_at','created_at','last_opened_at','content_json','before_content_json','after_content_json') and before_row->k is distinct from after_row->k;
 if before_row->'content_json' is distinct from after_row->'content_json' then delta:=delta||jsonb_build_object('content_changed',true); end if;
 cmd:=nullif(current_setting('manor.command_id',true),'')::uuid;
 if cmd is null then raise exception using errcode='42501',message='Writes require a Manor command'; end if;
 if delta<>'{}' then
 insert into public.action_events(user_id,command_id,actor,operation,object_type,object_id,changes,provenance)
 values(coalesce(auth.uid(),(coalesce(after_row->>'user_id',before_row->>'user_id'))::uuid),cmd,coalesce(nullif(current_setting('manor.actor',true),''),case when auth.uid() is null then 'background' when auth.jwt()->>'client_id' is null then 'user' else 'codex' end),current_setting('manor.operation'),tg_table_name,object_key,delta,nullif(current_setting('manor.provenance',true),'')::jsonb);
 end if;
 return coalesce(new,old);
end $$;
alter function manor_private.record_change() owner to manor_commands;
revoke all on function manor_private.record_change() from public;
do $triggers$
declare t text;
begin
 foreach t in array array['profiles','contexts','tasks','scratch_blocks','saved_task_views','habits','habit_lifecycle','habit_entries','habit_freeze_intents','mood_focus_entries','leetcode_attempts','leetcode_notes','job_roles','note_folders','note_pages','kb_entries','note_suggestions','weekly_reviews'] loop
 execute format('create trigger manor_history after insert or update or delete on public.%I for each row execute function manor_private.record_change()',t);
 end loop;
end $triggers$;

create function manor_private.require_revision(p_current bigint,p_expected bigint,p_record jsonb) returns void language plpgsql set search_path='' as $$
begin
 if p_expected is null or p_expected<>coalesce(p_current,0) then
 raise exception using errcode='PT409',message='Record changed. Reload and resolve the edit.',detail=jsonb_build_object('code','revision_conflict','expected_revision',p_expected,'current',p_record)::text;
 end if;
end $$;
revoke all on function manor_private.require_revision(bigint,bigint,jsonb) from public;
grant execute on function manor_private.require_revision(bigint,bigint,jsonb) to manor_commands;

create function manor_private.home_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; old_record jsonb; rid text:=p->>'id'; ctx public.contexts; task public.tasks; block public.scratch_blocks; view_row public.saved_task_views; account public.profiles;
begin
 case op
 when 'save_profile' then
  select * into account from public.profiles where user_id=auth.uid() for update;
  perform manor_private.require_revision(account.revision,(p->>'expected_revision')::bigint,to_jsonb(account));
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown account timezone'; end if;
  if length(p->>'name') not between 1 and 120 then raise exception 'Display name must contain 1 to 120 characters'; end if;
  insert into public.profiles(user_id,name,timezone,settings,revision) values(auth.uid(),p->>'name',p->>'timezone',coalesce(p->'settings','{}'),1)
  on conflict(user_id) do update set name=excluded.name,timezone=excluded.timezone,settings=excluded.settings,revision=public.profiles.revision+1 returning to_jsonb(profiles.*) into r;
 when 'create_context','update_context','remove_context' then
  select * into ctx from public.contexts where user_id=auth.uid() and id=rid for update;
  perform manor_private.require_revision(ctx.revision,(p->>'expected_revision')::bigint,to_jsonb(ctx));
  if op='create_context' then
   insert into public.contexts(user_id,id,name,color,icon) values(auth.uid(),rid,p->>'name',p->>'color',p->>'icon') returning to_jsonb(contexts.*) into r;
  elsif op='update_context' then
   update public.contexts set name=p->>'name',color=p->>'color',icon=p->>'icon',revision=revision+1 where user_id=auth.uid() and id=rid returning to_jsonb(contexts.*) into r;
   update public.tasks set context=p->>'name',revision=revision+1,updated_at=now() where user_id=auth.uid() and context_id=rid and context is distinct from p->>'name';
   update public.saved_task_views set rules=(select jsonb_agg(case when rule->>'property'='context' and rule->>'value'=ctx.name then jsonb_set(rule,'{value}',to_jsonb(p->>'name')) else rule end) from jsonb_array_elements(rules) rule),revision=revision+1 where user_id=auth.uid() and rules @> jsonb_build_array(jsonb_build_object('property','context','value',ctx.name));
  else
   if (select count(*) from public.contexts where user_id=auth.uid())<=1 then raise exception 'The last context cannot be removed'; end if;
   if exists(select 1 from public.tasks where user_id=auth.uid() and (context_id=rid or context=ctx.name)) then raise exception 'Move tasks out of this context before removing it'; end if;
   delete from public.contexts where user_id=auth.uid() and id=rid returning to_jsonb(contexts.*) into r;
  end if;
 when 'create_task','update_task','trash_task','restore_task' then
  select * into task from public.tasks where user_id=auth.uid() and id=rid for update;
  perform manor_private.require_revision(task.revision,(p->>'expected_revision')::bigint,to_jsonb(task));
  if op='create_task' then
   select * into ctx from public.contexts where user_id=auth.uid() and id=p->>'context_id';
   if ctx.id is null then raise exception 'Select an existing context'; end if;
   if p->>'recurrence' is not null then raise exception 'Use a recurrence series command for recurring tasks'; end if;
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,tags,completed_at)
   values(rid,auth.uid(),p->>'title',ctx.name,ctx.id,(p->>'estimate_minutes')::int,p->>'priority',p->>'status',(p->>'due')::date,array(select jsonb_array_elements_text(coalesce(p->'tags','[]'))),case when p->>'status'='Done' then now() end) returning to_jsonb(tasks.*) into r;
  elsif op='update_task' then
   if task.deleted_at is not null then raise exception 'Restore the task before editing it'; end if;
   select * into ctx from public.contexts where user_id=auth.uid() and id=coalesce(p->>'context_id',task.context_id);
   if ctx.id is null then raise exception 'Select an existing context'; end if;
   if p ? 'recurrence' then raise exception 'Use a recurrence series command to change recurrence'; end if;
   update public.tasks set title=coalesce(p->>'title',title),context=ctx.name,context_id=ctx.id,
    estimate_minutes=case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else estimate_minutes end,
    priority=case when p?'priority' then p->>'priority' else priority end,status=coalesce(p->>'status',status),due=coalesce((p->>'due')::date,due),
    tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,
    completed_at=case when p->>'status'='Done' and task.status<>'Done' then now() when p?'status' and p->>'status'<>'Done' then null else completed_at end,
    revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  elsif op='trash_task' then
   if task.deleted_at is not null then raise exception 'Task is already in Trash'; end if;
   update public.tasks set deleted_at=now(),revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  else
   if task.deleted_at is null or task.deleted_at<=now()-interval '7 days' then raise exception 'Task is not recoverable from Trash'; end if;
   update public.tasks set deleted_at=null,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  end if;
 when 'save_scratch_block','delete_scratch_block' then
  select * into block from public.scratch_blocks where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(block.revision,(p->>'expected_revision')::bigint,to_jsonb(block));
  if op='delete_scratch_block' then
   delete from public.scratch_blocks where id=rid and user_id=auth.uid() returning to_jsonb(scratch_blocks.*) into r;
  else
   if p->>'start_time'<'06:00' or p->>'end_time'>'24:00' or p->>'start_time'>=p->>'end_time' or substring(p->>'start_time',4,2)::int%15<>0 or substring(p->>'end_time',4,2)::int%15<>0 then raise exception 'Scratch blocks require 15-minute boundaries between 06:00 and midnight'; end if;
   if p->>'task_id' is not null and not exists(select 1 from public.tasks where user_id=auth.uid() and id=p->>'task_id' and deleted_at is null) then raise exception 'Scratch block task is unavailable'; end if;
   insert into public.scratch_blocks(id,user_id,task_id,date,start_time,end_time,portion,expires_at)
    values(rid,auth.uid(),p->>'task_id',(p->>'date')::date,p->>'start_time',p->>'end_time',p->>'portion',(((p->>'date')::date+(p->>'end_time')::time) at time zone (select timezone from public.profiles where user_id=auth.uid()))+interval '48 hours')
   on conflict(id) do update set task_id=excluded.task_id,date=excluded.date,start_time=excluded.start_time,end_time=excluded.end_time,portion=excluded.portion,expires_at=excluded.expires_at,revision=public.scratch_blocks.revision+1 returning to_jsonb(scratch_blocks.*) into r;
  end if;
 when 'save_task_view','delete_task_view' then
  select * into view_row from public.saved_task_views where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(view_row.revision,(p->>'expected_revision')::bigint,to_jsonb(view_row));
  if op='delete_task_view' then delete from public.saved_task_views where id=rid and user_id=auth.uid() returning to_jsonb(saved_task_views.*) into r;
  else
   if jsonb_typeof(p->'rules')<>'array' or jsonb_array_length(p->'rules')>30 then raise exception 'Saved views require at most 30 filter rules'; end if;
   insert into public.saved_task_views(id,user_id,name,rules) values(rid,auth.uid(),p->>'name',p->'rules') on conflict(id) do update set name=excluded.name,rules=excluded.rules,revision=public.saved_task_views.revision+1 returning to_jsonb(saved_task_views.*) into r;
  end if;
 else raise exception 'Unsupported home operation: %',op;
 end case;
 if r is null then raise exception using errcode='P0002',message='Record does not exist or is not owned by this account'; end if;
 return r;
end $$;
alter function manor_private.home_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.home_command(text,jsonb) from public;
