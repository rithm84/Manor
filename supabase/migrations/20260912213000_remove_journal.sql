-- The Journal feature is removed (PRD 2026-09-12): drop its schema and functions and take it out of recovery and workspace context.
create or replace function public.manor_acknowledge_recovery(p_snapshot_id text,p_ledger jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare accepted int;
begin
 if p_snapshot_id !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_ledger) is distinct from 'array' then raise exception 'A verified independent ledger snapshot is required'; end if;
 insert into manor_private.recovery_acknowledgements(user_id,object_type,object_id,purged_at,snapshot_id)
 select t.user_id,t.object_type,t.object_id,t.purged_at,p_snapshot_id
 from jsonb_to_recordset(p_ledger) as e(user_id uuid,object_type text,object_id text,purged_at timestamptz)
 join manor_private.purge_tombstones t on t.user_id=e.user_id and t.object_type=e.object_type and t.object_id=e.object_id and t.purged_at=e.purged_at
 on conflict(user_id,object_type,object_id) do update set purged_at=excluded.purged_at,snapshot_id=excluded.snapshot_id,acknowledged_at=clock_timestamp();
 get diagnostics accepted=row_count;
 if accepted<>jsonb_array_length(p_ledger) then raise exception 'Deletion ledger changed while its backup was acknowledged'; end if;
 return accepted;
end $$;

create or replace function public.manor_reconcile_recovery(p_ledger jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare item record; removed int:=0; review_key text;
begin
 if current_setting('manor.recovery_isolated',true) is distinct from 'yes' then raise exception 'Enable the isolated recovery session guard first'; end if;
 for item in select * from jsonb_to_recordset(p_ledger) as e(user_id uuid,object_type text,object_id text,purged_at timestamptz,series_id text,occurrence_date date,parent_folder_id text) loop
  insert into manor_private.purge_tombstones(user_id,object_type,object_id,purged_at,series_id,occurrence_date,parent_folder_id) values(item.user_id,item.object_type,item.object_id,item.purged_at,item.series_id,item.occurrence_date,item.parent_folder_id) on conflict do nothing;
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','recovery_purge',true);
  for review_key in select review_id from manor_private.review_sources where user_id=item.user_id and object_type=item.object_type and object_id=item.object_id loop
   delete from public.weekly_reviews where user_id=item.user_id and id=review_key;
   update public.action_events set changes='{}',provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type='weekly_reviews' and object_id=review_key;
   update manor_private.command_receipts set response=jsonb_build_object('purged',true) where user_id=item.user_id and response->'record'->>'id'=review_key;
  end loop;
  if item.object_type='tasks' then delete from public.tasks where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='job_roles' then delete from public.job_roles where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='leetcode_attempts' then delete from public.leetcode_attempts where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='leetcode_notes' then delete from public.leetcode_notes where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='note_folders' then
   update public.note_pages set folder_id=case when exists(select 1 from public.note_folders f where f.user_id=item.user_id and f.id=item.parent_folder_id) then item.parent_folder_id end where user_id=item.user_id and folder_id=item.object_id;
   update public.note_folders set parent_folder_id=case when exists(select 1 from public.note_folders f where f.user_id=item.user_id and f.id=item.parent_folder_id) then item.parent_folder_id end where user_id=item.user_id and parent_folder_id=item.object_id;
   delete from public.note_folders where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='note_pages' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='note' and parent_id=item.object_id;
   delete from public.note_pages where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='kb_entries' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='capture' and parent_id=item.object_id;
   delete from public.kb_entries where user_id=item.user_id and id=item.object_id::uuid;
  elsif item.object_type='file_objects' then
   update public.job_roles set resume_id=null where user_id=item.user_id and resume_id=item.object_id::uuid;
   delete from public.resumes where user_id=item.user_id and id=item.object_id::uuid;
   delete from public.note_attachments where user_id=item.user_id and id=item.object_id::uuid;
   update public.profiles set settings=settings-'avatar_file_id' where user_id=item.user_id and settings->>'avatar_file_id'=item.object_id;
   update public.kb_entries set screenshot_path=null where user_id=item.user_id and screenshot_path=(select storage_path from public.file_objects where user_id=item.user_id and id=item.object_id::uuid);
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and id=item.object_id::uuid;
   update public.action_events set changes='{}',provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type in ('resumes','note_attachments','file_objects') and object_id=item.object_id;
  else raise exception 'Unsupported recovery tombstone type: %',item.object_type;
  end if;
  update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and ((object_type=item.object_type and object_id=item.object_id) or (object_type='scratch_blocks' and (changes->'task_id'->>'before'=item.object_id or changes->'task_id'->>'after'=item.object_id)) or (object_type='note_suggestions' and changes::text like '%'||item.object_id||'%'));
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response::text like '%'||to_jsonb(item.object_id)::text||'%';
  removed:=removed+1;
 end loop;
 return removed;
end $$;

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

delete from manor_private.recovery_acknowledgements where object_type='journal_entries';
delete from manor_private.purge_tombstones where object_type='journal_entries';
drop function public.journal_read_state(),public.journal_save_keyring(jsonb,bigint),public.journal_save_entry(date,jsonb,bigint),public.journal_delete_entry(date,bigint,boolean);
drop schema journal_private cascade;
