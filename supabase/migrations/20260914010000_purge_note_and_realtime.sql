-- Permanent deletion from Trash, one purge routine for scheduled and explicit purges, and live action history for open clients.

-- Open clients subscribe to action_events; the publication never carried the table, so foreign changes only appeared after a reload.
do $$
begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='action_events') then
  alter publication supabase_realtime add table public.action_events;
 end if;
end $$;

-- The per-object purge, extracted from manor_purge_expired so an explicit deletion scrubs exactly what the scheduled purge scrubs.
create function manor_private.purge_object(p_user uuid,p_kind text,p_id text) returns void language plpgsql set search_path='' as $$
declare review_key text;
begin
  for review_key in select review_id from manor_private.review_sources where user_id=p_user and object_type=p_kind and object_id=p_id loop
   delete from public.weekly_reviews where user_id=p_user and id=review_key;
   update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=p_user and object_type='weekly_reviews' and object_id=review_key;
   update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=p_user and response->'record'->>'id'=review_key;
  end loop;
  if p_kind='tasks' then
   delete from public.tasks where user_id=p_user and id=p_id;
  elsif p_kind='job_roles' then
   delete from public.job_roles where user_id=p_user and id=p_id;
  elsif p_kind='leetcode_attempts' then delete from public.leetcode_attempts where user_id=p_user and id=p_id;
  elsif p_kind='leetcode_notes' then delete from public.leetcode_notes where user_id=p_user and id=p_id;
  elsif p_kind='note_folders' then delete from public.note_folders where user_id=p_user and id=p_id;
  elsif p_kind='kb_entries' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=p_user and purpose='capture' and parent_id=p_id;
   delete from public.kb_entries where user_id=p_user and id=p_id::uuid;
  else
   update public.file_objects set status='purging',name='Deleted file' where user_id=p_user and purpose='note' and parent_id=p_id;
   delete from public.note_pages where user_id=p_user and id=p_id;
  end if;
  update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=p_user and ((object_type=p_kind and object_id=p_id) or (object_type='scratch_blocks' and (changes->'task_id'->>'before'=p_id or changes->'task_id'->>'after'=p_id)) or (object_type='note_suggestions' and changes::text like '%'||p_id||'%'));
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=p_user and response::text like '%'||to_jsonb(p_id)::text||'%';
end $$;
revoke all on function manor_private.purge_object(uuid,text,text) from public;
grant execute on function manor_private.purge_object(uuid,text,text) to manor_commands;

create or replace function public.manor_purge_expired() returns integer language plpgsql security definer set search_path='' as $$
declare item record; total int:=0;
begin
 for item in select t.object_type as kind,t.object_id as id,t.user_id from manor_private.purge_tombstones t join manor_private.recovery_acknowledgements a using(user_id,object_type,object_id) where t.object_type in ('tasks','job_roles','note_pages','kb_entries','leetcode_attempts','leetcode_notes','note_folders') and a.purged_at=t.purged_at and ((t.object_type='tasks' and exists(select 1 from public.tasks x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='job_roles' and exists(select 1 from public.job_roles x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='note_pages' and exists(select 1 from public.note_pages x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='kb_entries' and exists(select 1 from public.kb_entries x where x.user_id=t.user_id and x.id=t.object_id::uuid)) or (t.object_type='leetcode_attempts' and exists(select 1 from public.leetcode_attempts x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='leetcode_notes' and exists(select 1 from public.leetcode_notes x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='note_folders' and exists(select 1 from public.note_folders x where x.user_id=t.user_id and x.id=t.object_id))) order by t.user_id,t.object_id limit 500 loop
  perform pg_advisory_xact_lock(hashtextextended(item.user_id::text,0));
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','purge_expired',true);
  perform manor_private.purge_object(item.user_id,item.kind,item.id);
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.manor_purge_expired() from public,anon,authenticated;
grant execute on function public.manor_purge_expired() to service_role;

-- purge_note: a note already in Trash, with its trashed subpages, is tombstoned and purged now instead of after the seven-day wait.
create function manor_private.purge_note_command(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare root public.note_pages; ids text[]; nid text;
begin
 select * into root from public.note_pages where user_id=auth.uid() and id=p->>'id' for update;
 if root.id is null then raise exception 'Note is unavailable'; end if;
 perform manor_private.require_revision(root.revision,(p->>'expected_revision')::bigint,to_jsonb(root));
 if root.status<>'trash' then raise exception 'Move the note to Trash before deleting it permanently'; end if;
 select array_agg(id order by id) into ids from public.note_pages where user_id=auth.uid() and status='trash' and (id=root.id or trash_root_id=root.id);
 insert into manor_private.purge_tombstones(user_id,object_type,object_id) select auth.uid(),'note_pages',unnest(ids) on conflict do nothing;
 foreach nid in array ids loop perform manor_private.purge_object(auth.uid(),'note_pages',nid); end loop;
 return jsonb_build_object('id',root.id,'purged',true,'purged_ids',to_jsonb(ids));
end $$;
revoke all on function manor_private.purge_note_command(jsonb) from public;
grant execute on function manor_private.purge_note_command(jsonb) to manor_commands;

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
