-- Pomodoro: focus and break sessions with one active session per account, plus timer preferences on the profile.
create table public.pomodoro_sessions (
 id text primary key check(length(id) between 1 and 200),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('focus','short_break','long_break')),
 status text not null check(status in ('running','paused','completed','abandoned')),
 label text check(label is null or length(label) between 1 and 120),
 planned_seconds integer not null check(planned_seconds between 60 and 14400),
 started_at timestamptz not null,
 paused_at timestamptz,
 paused_seconds integer not null default 0 check(paused_seconds>=0),
 ended_at timestamptz,
 focused_seconds integer check(focused_seconds is null or focused_seconds>=0),
 local_date date not null,
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status in ('running','paused'))=(ended_at is null)),
 check((status='paused')=(paused_at is not null)),
 check((status in ('completed','abandoned'))=(focused_seconds is not null))
);
create unique index pomodoro_sessions_one_active on public.pomodoro_sessions(user_id) where status in ('running','paused');
create index pomodoro_sessions_owner_day on public.pomodoro_sessions(user_id,local_date,started_at);
alter table public.pomodoro_sessions enable row level security;
grant select on public.pomodoro_sessions to authenticated;
grant select,insert,update,delete on public.pomodoro_sessions to manor_commands;
grant all on public.pomodoro_sessions to service_role;
create policy pomodoro_sessions_owner on public.pomodoro_sessions for select to authenticated using(user_id=(select auth.uid()));
create policy pomodoro_sessions_command on public.pomodoro_sessions to manor_commands using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create trigger manor_history after insert or update or delete on public.pomodoro_sessions for each row execute function manor_private.record_change();
create trigger manor_workspace_changes after insert or update or delete on public.pomodoro_sessions for each row execute function manor_private.record_workspace_change();

-- The account-local calendar day of an instant, used for daily statistics.
create function manor_private.local_date(p_at timestamptz) returns date language plpgsql stable set search_path='' as $$
declare tz text;
begin
 select timezone into tz from public.profiles where user_id=auth.uid();
 if tz is null then raise exception 'Save the account timezone before logging records'; end if;
 return (p_at at time zone tz)::date;
end $$;
revoke all on function manor_private.local_date(timestamptz) from public;
grant execute on function manor_private.local_date(timestamptz) to manor_commands;

create function manor_private.pomodoro_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; rid text:=p->>'id'; session public.pomodoro_sessions; account public.profiles; now_at timestamptz:=clock_timestamp();
 scheduled_end timestamptz; pause_total integer; focused integer; outcome text; prefs jsonb; current_prefs jsonb; key text; value jsonb;
begin
 if op='save_pomodoro_settings' then
  if auth.jwt()->>'client_id' is not null then raise exception using errcode='42501',message='Timer preferences can only be changed in Manor'; end if;
  select * into account from public.profiles where user_id=auth.uid() for update;
  if not found then raise exception 'Finish account setup before changing timer preferences'; end if;
  perform manor_private.require_revision(account.revision,(p->>'expected_revision')::bigint,jsonb_build_object('settings',account.settings,'revision',account.revision));
  prefs:=p->'settings';
  if jsonb_typeof(prefs) is distinct from 'object' then raise exception 'Timer preferences must be an object'; end if;
  for key,value in select * from jsonb_each(prefs) loop
   if key in ('focus_minutes','short_break_minutes','long_break_minutes') then
    if jsonb_typeof(value)<>'number' or (value::text)::numeric<>floor((value::text)::numeric) or (value::text)::integer not between 1 and 180 then raise exception '% must be a whole number of minutes from 1 to 180',key; end if;
   elsif key='long_break_every' then
    if jsonb_typeof(value)<>'number' or (value::text)::numeric<>floor((value::text)::numeric) or (value::text)::integer not between 1 and 12 then raise exception 'long_break_every must be a whole number from 1 to 12'; end if;
   elsif key in ('auto_start_breaks','auto_start_focus') then
    if jsonb_typeof(value)<>'boolean' then raise exception '% must be true or false',key; end if;
   else raise exception 'Unknown timer preference: %',key;
   end if;
  end loop;
  current_prefs:=coalesce(account.settings->'pomodoro','{}'::jsonb);
  update public.profiles set settings=jsonb_set(coalesce(profiles.settings,'{}'::jsonb),'{pomodoro}',current_prefs||prefs),revision=revision+1 where user_id=auth.uid() returning to_jsonb(profiles.*) into r;
  return r;
 end if;

 select * into session from public.pomodoro_sessions where user_id=auth.uid() and id=rid for update;
 perform manor_private.require_revision(session.revision,(p->>'expected_revision')::bigint,to_jsonb(session));

 case op
 when 'start_pomodoro_session' then
  if session.id is not null then raise exception 'Session ID already exists; use a new ID'; end if;
  if exists(select 1 from public.pomodoro_sessions where user_id=auth.uid() and status in ('running','paused')) then raise exception using errcode='55000',message='A session is already in progress'; end if;
  if p->>'kind' not in ('focus','short_break','long_break') then raise exception 'Session kind must be focus, short_break, or long_break'; end if;
  insert into public.pomodoro_sessions(id,user_id,kind,status,label,planned_seconds,started_at,local_date)
  values(rid,auth.uid(),p->>'kind','running',nullif(btrim(coalesce(p->>'label','')),''),(p->>'planned_seconds')::integer,now_at,manor_private.local_date(now_at)) returning to_jsonb(pomodoro_sessions.*) into r;
 when 'log_pomodoro_session' then
  if session.id is not null then raise exception 'Session ID already exists; use a new ID'; end if;
  if (p->>'started_at')::timestamptz is null then raise exception 'A logged session needs its start instant'; end if;
  focused:=(p->>'focused_seconds')::integer;
  if focused is null or focused not between 60 and 14400 then raise exception 'A logged session lasts between 1 minute and 4 hours'; end if;
  if (p->>'started_at')::timestamptz+make_interval(secs=>focused)>now_at then raise exception 'A logged session must have already ended'; end if;
  insert into public.pomodoro_sessions(id,user_id,kind,status,label,planned_seconds,started_at,ended_at,focused_seconds,local_date)
  values(rid,auth.uid(),'focus','completed',nullif(btrim(coalesce(p->>'label','')),''),focused,(p->>'started_at')::timestamptz,(p->>'started_at')::timestamptz+make_interval(secs=>focused),focused,manor_private.local_date((p->>'started_at')::timestamptz)) returning to_jsonb(pomodoro_sessions.*) into r;
 when 'pause_pomodoro_session' then
  if session.status<>'running' then raise exception 'Only a running session can be paused'; end if;
  update public.pomodoro_sessions set status='paused',paused_at=now_at,revision=revision+1,updated_at=now_at where user_id=auth.uid() and id=rid returning to_jsonb(pomodoro_sessions.*) into r;
 when 'resume_pomodoro_session' then
  if session.status<>'paused' then raise exception 'Only a paused session can be resumed'; end if;
  update public.pomodoro_sessions set status='running',paused_seconds=paused_seconds+greatest(0,floor(extract(epoch from now_at-paused_at)))::integer,paused_at=null,revision=revision+1,updated_at=now_at where user_id=auth.uid() and id=rid returning to_jsonb(pomodoro_sessions.*) into r;
 when 'end_pomodoro_session' then
  if session.status not in ('running','paused') then raise exception 'This session has already ended'; end if;
  outcome:=p->>'outcome';
  if outcome not in ('completed','abandoned') then raise exception 'Outcome must be completed or abandoned'; end if;
  pause_total:=session.paused_seconds+case when session.status='paused' then greatest(0,floor(extract(epoch from now_at-session.paused_at)))::integer else 0 end;
  scheduled_end:=session.started_at+make_interval(secs=>session.planned_seconds+pause_total);
  if outcome='completed' then
   if scheduled_end>now_at+interval '5 seconds' then raise exception using errcode='55000',message='This session has not finished yet'; end if;
   focused:=session.planned_seconds;
   update public.pomodoro_sessions set status='completed',paused_at=null,paused_seconds=pause_total,ended_at=least(now_at,scheduled_end),focused_seconds=focused,revision=revision+1,updated_at=now_at where user_id=auth.uid() and id=rid returning to_jsonb(pomodoro_sessions.*) into r;
  else
   focused:=greatest(0,least(session.planned_seconds,floor(extract(epoch from now_at-session.started_at))::integer-pause_total));
   update public.pomodoro_sessions set status='abandoned',paused_at=null,paused_seconds=pause_total,ended_at=now_at,focused_seconds=focused,revision=revision+1,updated_at=now_at where user_id=auth.uid() and id=rid returning to_jsonb(pomodoro_sessions.*) into r;
  end if;
 when 'update_pomodoro_session' then
  if session.id is null then raise exception 'Session is unavailable'; end if;
  if not (p?'label') then raise exception 'Supply the label to save'; end if;
  update public.pomodoro_sessions set label=nullif(btrim(coalesce(p->>'label','')),''),revision=revision+1,updated_at=now_at where user_id=auth.uid() and id=rid returning to_jsonb(pomodoro_sessions.*) into r;
 when 'delete_pomodoro_session' then
  if session.id is null then raise exception 'Session is unavailable'; end if;
  delete from public.pomodoro_sessions where user_id=auth.uid() and id=rid;
  r:=jsonb_build_object('id',rid,'deleted',true);
 else raise exception 'Unsupported Pomodoro operation: %',op;
 end case;
 return r;
end $$;
grant create on schema manor_private to manor_commands;
alter function manor_private.pomodoro_command(text,jsonb) owner to manor_commands;
revoke create on schema manor_private from manor_commands;
revoke all on function manor_private.pomodoro_command(text,jsonb) from public;
grant execute on function manor_private.pomodoro_command(text,jsonb) to manor_commands;

-- Agent read: sessions in a local-date range, newest first, with the range summary and the session in progress.
create function public.manor_pomodoro_query(p_query text,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; summary jsonb; active jsonb; take integer:=coalesce((p_input->>'limit')::integer,50); after timestamptz:=(p_input->>'cursor')::timestamptz;
 from_day date:=(p_input->>'from')::date; to_day date:=(p_input->>'to')::date; kind_filter text:=p_input->>'kind';
begin
 if auth.uid() is null then raise exception 'Sign in before reading Manor'; end if;
 if p_query<>'query_pomodoro_sessions' then raise exception 'Unsupported Pomodoro query: %',p_query; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or take not between 1 and 200 then raise exception 'Queries require object input and limit 1 to 200'; end if;
 if kind_filter is not null and kind_filter not in ('focus','short_break','long_break') then raise exception 'Session kind must be focus, short_break, or long_break'; end if;
 select coalesce(jsonb_agg(to_jsonb(s.*)-'user_id' order by started_at desc),'[]') into items from (
  select * from public.pomodoro_sessions where user_id=auth.uid() and status in ('completed','abandoned')
   and (from_day is null or local_date>=from_day) and (to_day is null or local_date<=to_day)
   and (kind_filter is null or kind=kind_filter) and (after is null or started_at<after)
  order by started_at desc limit take) s;
 select jsonb_build_object('completed_sessions',count(*) filter(where status='completed'),'abandoned_sessions',count(*) filter(where status='abandoned'),
  'focused_seconds',coalesce(sum(focused_seconds),0),'days_with_sessions',count(distinct local_date) filter(where status='completed')) into summary
  from public.pomodoro_sessions where user_id=auth.uid() and kind='focus' and status in ('completed','abandoned')
   and (from_day is null or local_date>=from_day) and (to_day is null or local_date<=to_day);
 select to_jsonb(s.*)-'user_id' into active from public.pomodoro_sessions s where user_id=auth.uid() and status in ('running','paused');
 return jsonb_build_object('items',items,'summary',summary,'active',active,
  'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'started_at' end);
end $$;
revoke all on function public.manor_pomodoro_query(text,jsonb) from public,anon;
grant execute on function public.manor_pomodoro_query(text,jsonb) to authenticated;

create or replace function manor_private.command(p_command_id uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt manor_private.command_receipts; fingerprint text; result jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before using Manor'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(true) then raise exception using errcode='42501',message='This agent is not authorized to write'; end if;
 if p_command_id is null or p_operation is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>13000000 then raise exception 'Command requires an ID, operation, and bounded object input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 fingerprint:=encode(sha256(convert_to(p_operation||p_input::text,'UTF8')),'hex');
 select * into receipt from manor_private.command_receipts where user_id=auth.uid() and command_id=p_command_id;
 if found then
  if receipt.input_hash<>fingerprint then raise exception using errcode='22023',message='Command ID was already used with different input'; end if;
  if receipt.response->>'purged'='true' then raise exception using errcode='P0002',message='Command result was purged'; end if;
  return receipt.response||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from manor_private.purge_tombstones where user_id=auth.uid() and object_id=p_input->>'id') then raise exception using errcode='P0002',message='Record was permanently purged and cannot be restored'; end if;
 perform set_config('manor.command_id',p_command_id::text,true);
 perform set_config('manor.actor',case when auth.jwt()->>'client_id' is null then 'user' else 'codex' end,true);
 perform set_config('manor.operation',p_operation,true);
 perform set_config('manor.provenance',coalesce((p_input->'provenance')::text,''),true);
 if p_operation='save_weekly_review' then result:=manor_private.weekly_review_command(p_input);
 elsif p_operation in ('import_note','duplicate_note','duplicate_note_blocks','remove_empty_note_folder','edit_note_media') then result:=manor_private.notes_tool_command(p_operation,p_input);
 elsif p_operation in ('update_preferences','retry_background_run') then result:=manor_private.workspace_tool_command(p_operation,p_input);
 elsif p_operation in ('link_records','unlink_records') then result:=manor_private.related_tool_command(p_operation,p_input);
 elsif p_operation='correct_mood_focus_history' then
  result:=manor_private.mood_focus_history_command(p_input);
 elsif p_operation in ('apply_leetcode_freeze','clear_leetcode_freeze') then
  result:=manor_private.leetcode_freeze_command(p_operation,p_input);
 elsif p_operation=any(array['start_pomodoro_session','pause_pomodoro_session','resume_pomodoro_session','end_pomodoro_session','update_pomodoro_session','delete_pomodoro_session','log_pomodoro_session','save_pomodoro_settings']) then result:=manor_private.pomodoro_command(p_operation,p_input);
 elsif p_operation='queue_embedding' then result:=manor_private.queue_embedding(p_input);
 elsif p_operation='edit_note_blocks' then result:=manor_private.edit_note_blocks(p_input);
 elsif p_operation=any(array['create_recurring_task','convert_task_to_series','skip_task_occurrence','update_future_task_occurrences']) then result:=manor_private.recurrence_command(p_operation,p_input);
 elsif p_operation=any(array['add_job_listing','touch_note','move_note_block','move_note_blocks','remove_capture']) then result:=manor_private.extra_command(p_operation,p_input);
 elsif p_operation=any(array['allocate_file','remove_resume']) then result:=manor_private.files_command(p_operation,p_input);
 elsif p_operation=any(array['apply_habit_freeze','clear_habit_freeze','reorder_habits']) then result:=manor_private.streak_command(p_operation,p_input);
 elsif p_operation=any(array['save_profile','create_context','update_context','remove_context','create_task','update_task','trash_task','restore_task','save_scratch_block','delete_scratch_block','save_task_view','delete_task_view']) then result:=manor_private.home_command(p_operation,p_input);
 elsif p_operation='purge_note' then result:=manor_private.purge_note_command(p_input);
 elsif p_operation=any(array['create_note_folder','update_note_folder','remove_note_folder','create_note','update_note','move_note','archive_note','trash_note','restore_note','restore_note_version','propose_note_edits','resolve_note_suggestions']) then result:=manor_private.notes_command(p_operation,p_input);
 elsif p_operation=any(array['commit_debrief','create_attempt','update_attempt','delete_attempt','save_mistake','delete_mistake','create_application','update_application','change_application_stage','trash_application','restore_application','create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','save_capture','save_weekly_review']) then result:=manor_private.domain_command(p_operation,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.command_receipts(user_id,command_id,operation,input_hash,response) values(auth.uid(),p_command_id,p_operation,fingerprint,result);
 return result;
end $$;
