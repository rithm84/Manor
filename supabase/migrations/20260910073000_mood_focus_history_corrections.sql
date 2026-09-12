create function manor_private.mood_focus_history_command(p jsonb) returns jsonb language plpgsql set search_path='' as $$
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
 insert into public.mood_focus_entries(user_id,date,mood,focus,note,note_source)
 values(auth.uid(),day,p->>'mood',p->>'focus',daily.note,daily.note_source)
 on conflict(user_id,date) do update set
  mood=excluded.mood,
  focus=excluded.focus,
  updated_at=now(),
  revision=public.mood_focus_entries.revision+1
 returning to_jsonb(mood_focus_entries.*) into r;
 return r;
end $$;
grant create on schema manor_private to manor_commands;
alter function manor_private.mood_focus_history_command(jsonb) owner to manor_commands;
revoke create on schema manor_private from manor_commands;
revoke all on function manor_private.mood_focus_history_command(jsonb) from public;
grant execute on function manor_private.mood_focus_history_command(jsonb) to manor_commands;

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
 if p_operation='correct_mood_focus_history' then
  result:=manor_private.mood_focus_history_command(p_input);
 elsif p_operation in ('apply_leetcode_freeze','clear_leetcode_freeze') then
  result:=manor_private.leetcode_freeze_command(p_operation,p_input);
 elsif p_operation='queue_embedding' then result:=manor_private.queue_embedding(p_input);
 elsif p_operation='edit_note_blocks' then result:=manor_private.edit_note_blocks(p_input);
 elsif p_operation=any(array['create_recurring_task','convert_task_to_series','skip_task_occurrence','update_future_task_occurrences']) then result:=manor_private.recurrence_command(p_operation,p_input);
 elsif p_operation=any(array['add_job_listing','touch_note','move_note_block','move_note_blocks','remove_capture']) then result:=manor_private.extra_command(p_operation,p_input);
 elsif p_operation=any(array['allocate_file','remove_resume']) then result:=manor_private.files_command(p_operation,p_input);
 elsif p_operation=any(array['apply_habit_freeze','clear_habit_freeze','reorder_habits']) then result:=manor_private.streak_command(p_operation,p_input);
 elsif p_operation=any(array['save_profile','create_context','update_context','remove_context','create_task','update_task','trash_task','restore_task','save_scratch_block','delete_scratch_block','save_task_view','delete_task_view']) then result:=manor_private.home_command(p_operation,p_input);
 elsif p_operation=any(array['create_note_folder','update_note_folder','remove_note_folder','create_note','update_note','move_note','archive_note','trash_note','restore_note','restore_note_version','propose_note_edits','resolve_note_suggestions']) then result:=manor_private.notes_command(p_operation,p_input);
 elsif p_operation=any(array['commit_debrief','create_attempt','update_attempt','delete_attempt','save_mistake','delete_mistake','create_application','update_application','change_application_stage','trash_application','restore_application','create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','save_capture','save_weekly_review']) then result:=manor_private.domain_command(p_operation,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.command_receipts(user_id,command_id,operation,input_hash,response) values(auth.uid(),p_command_id,p_operation,fingerprint,result);
 return result;
end $$;
