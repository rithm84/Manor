-- Optional minute-precision task deadlines in the saved account timezone.
-- Existing dates and records remain date-only until a time is explicitly supplied.
begin;
alter table public.tasks add column due_time text
 check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.task_series add column due_time text
 check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create or replace function manor_private.home_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
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
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,due_time,tags,completed_at)
   values(rid,auth.uid(),p->>'title',ctx.name,ctx.id,(p->>'estimate_minutes')::int,p->>'priority',p->>'status',(p->>'due')::date,p->>'due_time',array(select jsonb_array_elements_text(coalesce(p->'tags','[]'))),case when p->>'status'='Done' then now() end) returning to_jsonb(tasks.*) into r;
  elsif op='update_task' then
   if task.deleted_at is not null then raise exception 'Restore the task before editing it'; end if;
   select * into ctx from public.contexts where user_id=auth.uid() and id=coalesce(p->>'context_id',task.context_id);
   if ctx.id is null then raise exception 'Select an existing context'; end if;
   if p ? 'recurrence' then raise exception 'Use a recurrence series command to change recurrence'; end if;
   update public.tasks set title=coalesce(p->>'title',title),context=ctx.name,context_id=ctx.id,
    estimate_minutes=case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else estimate_minutes end,
    priority=case when p?'priority' then p->>'priority' else priority end,status=coalesce(p->>'status',status),due=coalesce((p->>'due')::date,due),
    due_time=case when p?'due_time' then p->>'due_time' else due_time end,
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

create or replace function manor_private.materialize_series(series_key text) returns void language plpgsql set search_path='' as $$
declare s public.task_series; day date; horizon date:=manor_private.today()+90; context_name text;
begin
 select * into s from public.task_series where id=series_key and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Recurrence series is unavailable'; end if;
 if s.starts_on<manor_private.today()-1826 then raise exception 'Recurrence catch-up exceeds five years; reconcile the older series explicitly'; end if;
 select name into context_name from public.contexts where user_id=auth.uid() and id=s.context_id;
 for day in select generate_series(coalesce(s.materialized_through+1,s.starts_on),least(horizon,coalesce(s.ends_before-1,horizon)),interval '1 day')::date loop
  if manor_private.rule_matches(s.rule,s.starts_on,day) and not exists(select 1 from manor_private.purge_tombstones t where t.user_id=auth.uid() and t.object_type='tasks' and t.series_id=s.id and t.occurrence_date=day) then
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,due_time,tags,recurrence,series_id,occurrence_date)
   values(case when day=s.starts_on then s.id else gen_random_uuid()::text end,auth.uid(),s.title,context_name,s.context_id,s.estimate_minutes,s.priority,'Not started',day,s.due_time,s.tags,s.rule,s.id,day)
   on conflict(user_id,series_id,occurrence_date) do nothing;
  end if;
 end loop;
 update public.task_series set materialized_through=horizon where id=s.id and user_id=auth.uid();
end $$;
create or replace function manor_private.recurrence_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare t public.tasks; s public.task_series; series_key text:=p->>'id'; r jsonb;
begin
 if op='create_recurring_task' then
  if (p->>'expected_revision')::bigint<>0 then raise exception 'New recurring task requires revision zero'; end if;
  perform manor_private.rule_matches(p->>'recurrence',(p->>'due')::date,(p->>'due')::date);
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags,due_time)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',p->>'title',p->>'context_id',(p->>'estimate_minutes')::int,p->>'priority',array(select jsonb_array_elements_text(p->'tags')),p->>'due_time');
  perform manor_private.materialize_series(series_key);
  select to_jsonb(tasks.*) into r from public.tasks where user_id=auth.uid() and series_id=series_key order by occurrence_date limit 1;
  if r is null then raise exception 'Recurrence does not produce an occurrence in the next 90 days'; end if;
 elsif op='convert_task_to_series' then
  select * into t from public.tasks where id=series_key and user_id=auth.uid() for update;
  perform manor_private.require_revision(t.revision,(p->>'expected_revision')::bigint,to_jsonb(t));
  if t.id is null or t.series_id is not null or t.deleted_at is not null then raise exception 'Choose an available standalone task'; end if;
  perform manor_private.rule_matches(p->>'recurrence',(p->>'due')::date,(p->>'due')::date);
  series_key:=p->>'new_series_id';
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags,due_time)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',coalesce(p->>'title',t.title),coalesce(p->>'context_id',t.context_id),case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else t.estimate_minutes end,case when p?'priority' then p->>'priority' else t.priority end,case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else t.tags end,case when p?'due_time' then p->>'due_time' else t.due_time end);
  update public.tasks set series_id=series_key,occurrence_date=(p->>'due')::date,due=(p->>'due')::date,due_time=case when p?'due_time' then p->>'due_time' else due_time end,recurrence=p->>'recurrence',title=coalesce(p->>'title',title),context_id=coalesce(p->>'context_id',context_id),context=(select name from public.contexts where user_id=auth.uid() and id=coalesce(p->>'context_id',t.context_id)),estimate_minutes=case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else estimate_minutes end,priority=case when p?'priority' then p->>'priority' else priority end,tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,status=coalesce(p->>'status',status),completed_at=case when p->>'status'='Done' then now() when p?'status' then null else completed_at end,revision=revision+1,updated_at=now() where id=t.id and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
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
   update public.tasks set superseded_at=null,series_id=null,occurrence_date=null,recurrence=null,due=(p->>'due')::date,due_time=case when p?'due_time' then p->>'due_time' else due_time end,title=coalesce(p->>'title',title),revision=revision+1,updated_at=now() where id=t.id and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
   return r;
  end if;
  series_key:=p->>'new_series_id';
  insert into public.task_series(id,user_id,starts_on,rule,title,context_id,estimate_minutes,priority,tags,due_time)
  values(series_key,auth.uid(),(p->>'due')::date,p->>'recurrence',coalesce(p->>'title',s.title),coalesce(p->>'context_id',s.context_id),case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else s.estimate_minutes end,case when p?'priority' then p->>'priority' else s.priority end,case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else s.tags end,case when p?'due_time' then p->>'due_time' else t.due_time end);
  perform manor_private.materialize_series(series_key);
  select to_jsonb(tasks.*) into r from public.tasks where user_id=auth.uid() and series_id=series_key order by occurrence_date limit 1;
 else raise exception 'Unsupported recurrence operation'; end if;
 return r;
end $$;
alter function manor_private.recurrence_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.recurrence_command(text,jsonb) from public;


create or replace function public.manor_workspace_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
   'restrictions',jsonb_build_object('calendar','read_only','live_browser_context','unavailable','unsaved_drafts','unavailable','changes_begin','feed_installation','note_interchange','block_json_only','bookmark_preview_refresh','unavailable'));
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
   select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows_json from (select id,title,status,due,due_time,context_id,priority,revision from public.tasks where user_id=auth.uid() and due=first_day and deleted_at is null and skipped_at is null and superseded_at is null order by id limit row_limit) t;
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
commit;
