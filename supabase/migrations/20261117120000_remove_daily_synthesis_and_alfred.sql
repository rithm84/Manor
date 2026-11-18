-- Manor no longer has an AI-written daily synthesis or debrief, and the Alfred assistant is gone (PRD decision log,
-- 2026-11-17). This permanently deletes the synthesis text and its provenance from daily records, history, command
-- receipts, and weekly review input snapshots, drops the Alfred tables and their memory search, and replaces the
-- commit_debrief operation with log_daily_ratings, which saves Mood and Focus for today or yesterday. Function bodies
-- are restated from their deployed definitions with only these changes.

-- Alfred: audit trail, shared memories, and their vector search. Policies, indexes, and grants go with the tables.
drop function if exists public.match_alfred_memories;
drop table if exists public.alfred_memories;
drop table if exists public.alfred_actions;

-- A day that holds only a synthesis has no ratings left once the synthesis is gone, so the day is removed.
do $$
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='mood_focus_entries' and column_name='note') then
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','remove_daily_synthesis',true);
  perform set_config('manor.actor','background',true);
  perform set_config('manor.provenance','',true);
  delete from public.mood_focus_entries where mood is null and focus is null;
 end if;
end $$;

-- History keeps each daily record event but loses the synthesis fields; events that carried synthesis text are marked scrubbed.
update public.action_events set
 changes=changes-'note'-'note_source',
 scrubbed_at=case when coalesce(changes->'note'->>'before',changes->'note'->>'after',changes->'note_source'->>'before',changes->'note_source'->>'after') is not null then coalesce(scrubbed_at,now()) else scrubbed_at end
where object_type='mood_focus_entries' and changes ?| array['note','note_source'];

-- Replayed command results return the daily record without synthesis fields.
update manor_private.command_receipts set response=jsonb_set(response,'{record}',(response->'record')-'note'-'note_source')
where operation in ('commit_debrief','correct_mood_focus_history') and jsonb_typeof(response->'record')='object' and response->'record' ?| array['note','note_source'];

-- Weekly review input snapshots keep their records and history without synthesis fields.
update manor_private.weekly_review_snapshots s set payload=s.payload||jsonb_build_object(
 'daily_records',(select coalesce(jsonb_agg(d-'note'-'note_source' order by o),'[]') from jsonb_array_elements(s.payload->'daily_records') with ordinality x(d,o)),
 'history',(select coalesce(jsonb_agg(case when e->>'object_type'='mood_focus_entries' and jsonb_typeof(e->'changes')='object' then jsonb_set(e,'{changes}',(e->'changes')-'note'-'note_source') else e end order by o),'[]') from jsonb_array_elements(s.payload->'history') with ordinality y(e,o)))
where jsonb_typeof(s.payload->'daily_records')='array' and jsonb_typeof(s.payload->'history')='array'
 and (s.payload->'daily_records' @? '$[*] ? (exists(@.note) || exists(@.note_source))' or s.payload->'history' @? '$[*].changes ? (exists(@.note) || exists(@.note_source))');

-- A daily record is now only its two ratings.
alter table public.mood_focus_entries
 drop constraint if exists mood_focus_has_content,
 drop constraint if exists mood_focus_entries_check1,
 drop constraint if exists mood_focus_entries_note_check,
 drop constraint if exists mood_focus_entries_note_source_check,
 drop column if exists note,
 drop column if exists note_source;
alter table public.mood_focus_entries add constraint mood_focus_has_content check(mood is not null or focus is not null);

-- log_daily_ratings replaces commit_debrief: explicit Mood and Focus for today or yesterday. An omitted rating keeps
-- its saved value and a null clears it, but a day keeps at least one rating.
CREATE OR REPLACE FUNCTION manor_private.domain_command(op text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r jsonb; rid text:=p->>'id'; today date:=manor_private.today(); day date:=(p->>'date')::date;
 daily public.mood_focus_entries; attempt public.leetcode_attempts; mistake public.leetcode_notes; application public.job_roles; habit public.habits; entry public.habit_entries; capture public.kb_entries; review public.weekly_reviews; stage_value text;
begin
 case op
 when 'log_daily_ratings' then
  if day is null or day not in (today,today-1) then raise exception 'Daily ratings can only be logged today or yesterday'; end if;
  if not (p?'mood' or p?'focus') then raise exception 'Choose a mood or focus rating'; end if;
  if p->>'mood' is not null and p->>'mood' not in ('Great','Good','Neutral','Bad','Awful') then raise exception 'Unknown mood rating'; end if;
  if p->>'focus' is not null and p->>'focus' not in ('Locked In','High','Medium','Low','Locked Out','Resting') then raise exception 'Unknown focus rating'; end if;
  select * into daily from public.mood_focus_entries where user_id=auth.uid() and date=day for update;
  perform manor_private.require_revision(daily.revision,(p->>'expected_revision')::bigint,to_jsonb(daily));
  if (case when p?'mood' then p->>'mood' else daily.mood end) is null and (case when p?'focus' then p->>'focus' else daily.focus end) is null then raise exception 'Choose a mood or focus rating'; end if;
  insert into public.mood_focus_entries(user_id,date,mood,focus)
  values(auth.uid(),day,case when p?'mood' then p->>'mood' else daily.mood end,case when p?'focus' then p->>'focus' else daily.focus end)
  on conflict(user_id,date) do update set mood=excluded.mood,focus=excluded.focus,updated_at=now(),revision=public.mood_focus_entries.revision+1 returning to_jsonb(mood_focus_entries.*) into r;
 when 'create_attempt','update_attempt','delete_attempt' then
  select * into attempt from public.leetcode_attempts where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(attempt.revision,(p->>'expected_revision')::bigint,to_jsonb(attempt));
  if attempt.deleted_at is not null then raise exception 'Attempt was removed'; end if;
  if op='delete_attempt' then update public.leetcode_attempts set deleted_at=now(),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_attempts.*) into r;
  else
   if day>today or day is null then raise exception 'Attempt date must be today or a past date'; end if;
   if length(p->>'solution') not between 1 and 1000000 then raise exception 'Paste solution source between 1 and 1000000 characters'; end if;
   if op='create_attempt' then
    insert into public.leetcode_attempts(id,user_id,problem_id,date,solution) values(rid,auth.uid(),p->>'problem_id',day,p->>'solution') returning to_jsonb(leetcode_attempts.*) into r;
   else
    update public.leetcode_attempts set date=day,solution=p->>'solution',revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_attempts.*) into r;
   end if;
  end if;
 when 'save_mistake','delete_mistake' then
  select * into mistake from public.leetcode_notes where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(mistake.revision,(p->>'expected_revision')::bigint,to_jsonb(mistake));
  if mistake.deleted_at is not null then raise exception 'Mistake was removed'; end if;
  if op='delete_mistake' then update public.leetcode_notes set deleted_at=now(),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_notes.*) into r;
  else insert into public.leetcode_notes(id,user_id,text) values(rid,auth.uid(),p->>'text') on conflict(id) do update set text=excluded.text,revision=public.leetcode_notes.revision+1,updated_at=now() returning to_jsonb(leetcode_notes.*) into r;
  end if;
 when 'create_application','update_application','change_application_stage','trash_application','restore_application' then
  select * into application from public.job_roles where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(application.revision,(p->>'expected_revision')::bigint,to_jsonb(application));
  if application.deleted_at is not null and op<>'restore_application' then raise exception 'Restore the application before editing it'; end if;
  if op='create_application' then
   insert into public.job_roles(id,user_id,company,role,location,link,posted,stage,applied,oa_due,oa_done,interview1,interview2,interview3,decision,resume_id,term)
   values(rid,auth.uid(),p->>'company',p->>'role',p->>'location',p->>'link',(p->>'posted')::date,p->>'stage',(p->>'applied')::date,(p->>'oa_due')::date,(p->>'oa_done')::date,(p->>'interview1')::date,(p->>'interview2')::date,(p->>'interview3')::date,(p->>'decision')::date,(p->>'resume_id')::uuid,p->>'term') returning to_jsonb(job_roles.*) into r;
  elsif op in ('update_application','change_application_stage') then
   update public.job_roles set company=coalesce(p->>'company',company),role=coalesce(p->>'role',role),location=coalesce(p->>'location',location),link=coalesce(p->>'link',link),stage=coalesce(p->>'stage',stage),
    posted=case when p?'posted' then (p->>'posted')::date else posted end,
    applied=case when p?'applied' then (p->>'applied')::date else applied end,
    oa_due=case when p?'oa_due' then (p->>'oa_due')::date else oa_due end,
    oa_done=case when p?'oa_done' then (p->>'oa_done')::date else oa_done end,
    interview1=case when p?'interview1' then (p->>'interview1')::date else interview1 end,
    interview2=case when p?'interview2' then (p->>'interview2')::date else interview2 end,
    interview3=case when p?'interview3' then (p->>'interview3')::date else interview3 end,
    decision=case when p?'decision' then (p->>'decision')::date else decision end,
    resume_id=case when p?'resume_id' then (p->>'resume_id')::uuid else resume_id end,
    term=case when p?'term' then p->>'term' else term end,revision=revision+1,updated_at=now()
    where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  elsif op='trash_application' then
   update public.job_roles set deleted_at=now(),revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  else
   if application.deleted_at is null or application.deleted_at<=now()-interval '7 days' then raise exception 'Application is not recoverable from Trash'; end if;
   update public.job_roles set deleted_at=null,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  end if;
  if r->>'stage' is distinct from application.stage then insert into public.job_stage_transitions(id,user_id,role_id,from_stage,to_stage) values(gen_random_uuid()::text,auth.uid(),rid,application.stage,r->>'stage'); end if;
 when 'create_habit','update_habit','set_habit_status' then
  select * into habit from public.habits where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(habit.revision,(p->>'expected_revision')::bigint,to_jsonb(habit));
  if op='create_habit' then
   insert into public.habits(id,user_id,name,kind,target_label,created_on,position) values(rid,auth.uid(),p->>'name',p->>'kind',p->>'target_label',today,coalesce((p->>'position')::int,(select coalesce(max(position)+1,0) from public.habits where user_id=auth.uid()))) returning to_jsonb(habits.*) into r;
   insert into public.habit_lifecycle(user_id,habit_id,date,status) values(auth.uid(),rid,today,'active');
  elsif op='update_habit' then
   update public.habits set name=coalesce(p->>'name',name),kind=coalesce(p->>'kind',kind),target_label=case when p?'target_label' then p->>'target_label' else target_label end,position=coalesce((p->>'position')::int,position),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(habits.*) into r;
  else
   insert into public.habit_lifecycle(user_id,habit_id,date,status) values(auth.uid(),rid,today,p->>'status') on conflict(habit_id,date) do update set status=excluded.status;
   update public.habits set revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(habits.*) into r;
  end if;
 when 'log_habit','clear_habit_entry' then
  if day not in (today,today-1) then raise exception 'Habits can only be logged today or yesterday'; end if;
  select * into habit from public.habits where id=rid and user_id=auth.uid();
  if habit.id is null or habit.created_on>day or coalesce((select status from public.habit_lifecycle where habit_id=rid and user_id=auth.uid() and date<=day order by date desc limit 1),'active')<>'active' then raise exception 'Habit is not active on this date'; end if;
  select * into entry from public.habit_entries where habit_id=rid and date=day and user_id=auth.uid() for update;
  perform manor_private.require_revision(entry.revision,(p->>'expected_revision')::bigint,to_jsonb(entry));
  if op='clear_habit_entry' then delete from public.habit_entries where habit_id=rid and date=day and user_id=auth.uid() returning to_jsonb(habit_entries.*) into r;
  else
   if habit.kind='binary' and (p->>'value')::int<>100 then raise exception 'Binary habits can only be completed'; end if;
   insert into public.habit_entries(user_id,habit_id,date,value) values(auth.uid(),rid,day,(p->>'value')::int) on conflict(habit_id,date) do update set value=excluded.value,revision=public.habit_entries.revision+1,updated_at=now() returning to_jsonb(habit_entries.*) into r;
   if (p->>'value')::int=100 then delete from public.habit_freeze_intents where habit_id=rid and date=day and user_id=auth.uid(); delete from public.habit_freeze_usage where habit_id=rid and date=day and user_id=auth.uid(); end if;
  end if;
 when 'save_capture' then
  select * into capture from public.kb_entries where id=rid::uuid and user_id=auth.uid() for update;
  perform manor_private.require_revision(capture.revision,(p->>'expected_revision')::bigint,to_jsonb(capture));
  insert into public.kb_entries(id,user_id,source,url,title,author,summary,content_md,status,normalized_at) values(rid::uuid,auth.uid(),'capture',p->>'url',p->>'title',p->>'author',p->>'summary',p->>'content_md','normalized',now())
  on conflict(id) do update set url=excluded.url,title=excluded.title,author=excluded.author,summary=excluded.summary,content_md=excluded.content_md,revision=public.kb_entries.revision+1 returning to_jsonb(kb_entries.*) into r;
 when 'save_weekly_review' then
  select * into review from public.weekly_reviews where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(review.revision,(p->>'expected_revision')::bigint,to_jsonb(review));
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown review timezone'; end if;
  if (p->>'period_end')::timestamptz>now() or ((p->>'period_end')::timestamptz at time zone (p->>'timezone'))-((p->>'period_start')::timestamptz at time zone (p->>'timezone'))<>interval '7 days' or extract(dow from ((p->>'period_end')::timestamptz at time zone (p->>'timezone')))<>0 or ((p->>'period_end')::timestamptz at time zone (p->>'timezone'))::time<>'22:00'::time then raise exception 'Review period must cover Sunday 22:00 to Sunday 22:00 in its saved timezone'; end if;
  if (p->>'input_watermark')::bigint>(select coalesce(max(id),0) from public.action_events where user_id=auth.uid()) then raise exception 'Review watermark exceeds account history'; end if;
  insert into public.weekly_reviews(id,user_id,period_start,period_end,input_watermark,content,model,timezone,title) values(rid,auth.uid(),(p->>'period_start')::timestamptz,(p->>'period_end')::timestamptz,(p->>'input_watermark')::bigint,p->>'content',p->>'model',p->>'timezone',p->>'title') on conflict(id) do update set content=excluded.content,model=excluded.model,input_watermark=excluded.input_watermark,title=excluded.title,revision=public.weekly_reviews.revision+1,updated_at=now() returning to_jsonb(weekly_reviews.*) into r;
 else raise exception 'Unsupported domain operation: %',op;
 end case;
 if r is null then raise exception using errcode='P0002',message='Record does not exist or is not owned by this account'; end if;
 return r;
end $function$;

-- History corrections for earlier days no longer read or preserve synthesis fields.
CREATE OR REPLACE FUNCTION manor_private.mood_focus_history_command(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 r jsonb;
 daily public.mood_focus_entries;
 today date:=manor_private.today();
 day date:=(p->>'date')::date;
begin
 if auth.jwt()->>'client_id' is not null then raise exception using errcode='42501',message='Mood and focus history can only be corrected in Manor'; end if;
 if day is null or day>=today then raise exception 'History corrections require a date before today'; end if;
 if not (p?'mood') or not (p?'focus') then raise exception 'History corrections require explicit mood and focus fields'; end if;
 if p->>'mood' is null and p->>'focus' is null then raise exception 'Choose a mood or focus rating'; end if;
 if p->>'mood' is not null and p->>'mood' not in ('Great','Good','Neutral','Bad','Awful') then raise exception 'Unknown mood rating'; end if;
 if p->>'focus' is not null and p->>'focus' not in ('Locked In','High','Medium','Low','Locked Out','Resting') then raise exception 'Unknown focus rating'; end if;
 select * into daily from public.mood_focus_entries where user_id=auth.uid() and date=day for update;
 perform manor_private.require_revision(daily.revision,(p->>'expected_revision')::bigint,to_jsonb(daily));
 insert into public.mood_focus_entries(user_id,date,mood,focus)
 values(auth.uid(),day,p->>'mood',p->>'focus')
 on conflict(user_id,date) do update set
  mood=excluded.mood,
  focus=excluded.focus,
  updated_at=now(),
  revision=public.mood_focus_entries.revision+1
 returning to_jsonb(mood_focus_entries.*) into r;
 return r;
end $function$;

-- The dispatcher routes log_daily_ratings; commit_debrief is now an unsupported operation.
CREATE OR REPLACE FUNCTION manor_private.command(p_command_id uuid, p_operation text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  raise exception using errcode='22023',message='Practice streaks and freezes have been removed';
 elsif p_operation in ('merge_problem_duplicates','unmerge_problem_duplicate') then
  result:=manor_private.problem_duplicate_command(p_operation,p_input);
 elsif p_operation in ('save_problem','import_problems','save_problem_view','delete_problem_view','save_problem_draft') then
  result:=manor_private.problem_library_command(p_operation,p_input);
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
 elsif p_operation=any(array['log_daily_ratings','create_attempt','update_attempt','delete_attempt','save_mistake','delete_mistake','create_application','update_application','change_application_stage','trash_application','restore_application','create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','save_capture','save_weekly_review']) then result:=manor_private.domain_command(p_operation,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.command_receipts(user_id,command_id,operation,input_hash,response) values(auth.uid(),p_command_id,p_operation,fingerprint,result);
 return result;
end $function$;
