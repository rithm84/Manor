create function manor_private.command(p_command_id uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if p_operation in ('apply_leetcode_freeze','clear_leetcode_freeze') then
  result:=manor_private.leetcode_freeze_command(p_operation,p_input);
 elsif p_operation='queue_embedding' then
  result:=manor_private.queue_embedding(p_input);
 elsif p_operation='edit_note_blocks' then
  result:=manor_private.edit_note_blocks(p_input);
 elsif p_operation=any(array['create_recurring_task','convert_task_to_series','skip_task_occurrence','update_future_task_occurrences']) then
  result:=manor_private.recurrence_command(p_operation,p_input);
 elsif p_operation=any(array['add_job_listing','touch_note','move_note_block','move_note_blocks','remove_capture']) then
  result:=manor_private.extra_command(p_operation,p_input);
 elsif p_operation=any(array['allocate_file','remove_resume']) then
  result:=manor_private.files_command(p_operation,p_input);
 elsif p_operation=any(array['apply_habit_freeze','clear_habit_freeze','reorder_habits']) then
  result:=manor_private.streak_command(p_operation,p_input);
 elsif p_operation=any(array['save_profile','create_context','update_context','remove_context','create_task','update_task','trash_task','restore_task','save_scratch_block','delete_scratch_block','save_task_view','delete_task_view']) then
  result:=manor_private.home_command(p_operation,p_input);
 elsif p_operation=any(array['create_note_folder','update_note_folder','remove_note_folder','create_note','update_note','move_note','archive_note','trash_note','restore_note','restore_note_version','propose_note_edits','resolve_note_suggestions']) then
  result:=manor_private.notes_command(p_operation,p_input);
 elsif p_operation=any(array['commit_debrief','create_attempt','update_attempt','delete_attempt','save_mistake','delete_mistake','create_application','update_application','change_application_stage','trash_application','restore_application','create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','save_capture','save_weekly_review']) then
  result:=manor_private.domain_command(p_operation,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.command_receipts(user_id,command_id,operation,input_hash,response) values(auth.uid(),p_command_id,p_operation,fingerprint,result);
 return result;
end $$;
alter function manor_private.command(uuid,text,jsonb) owner to manor_commands;
revoke all on function manor_private.command(uuid,text,jsonb) from public;
grant execute on function manor_private.command(uuid,text,jsonb) to authenticated;
create function public.manor_command(p_command_id uuid,p_operation text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select manor_private.command(p_command_id,p_operation,p_input)
$$;
revoke all on function public.manor_command(uuid,text,jsonb) from public,anon;
grant execute on function public.manor_command(uuid,text,jsonb) to authenticated;
create function public.manor_batch(p_commands jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; result jsonb:='[]';
begin
 if jsonb_typeof(p_commands) is distinct from 'array' or jsonb_array_length(p_commands) not between 1 and 50 then raise exception 'Atomic batches require 1 to 50 commands'; end if;
 for item in select value from jsonb_array_elements(p_commands) loop
  result:=result||jsonb_build_array(public.manor_command((item->>'command_id')::uuid,item->>'operation',item->'input'));
 end loop;
 return result;
end $$;
revoke all on function public.manor_batch(jsonb) from public,anon;
grant execute on function public.manor_batch(jsonb) to authenticated;

-- Private integration tokens are never returned through ordinary Data API reads.
revoke all on public.x_connections from anon,authenticated;
revoke all on public.alfred_memories from anon,authenticated;

create table manor_private.signup_grants(email text primary key,expires_at timestamptz not null,consumed_at timestamptz);
create table manor_private.signup_attempts(email_hash text not null,attempted_at timestamptz not null default clock_timestamp());
create index signup_attempt_window on manor_private.signup_attempts(attempted_at,email_hash);
alter table manor_private.signup_grants enable row level security;
alter table manor_private.signup_attempts enable row level security;
create function public.manor_signup_attempt(p_email_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('manor_signup_rate',0));
 delete from manor_private.signup_attempts where attempted_at<now()-interval '15 minutes';
 if (select count(*) from manor_private.signup_attempts)>=100 or (select count(*) from manor_private.signup_attempts where email_hash=p_email_hash)>=5 then return false; end if;
 insert into manor_private.signup_attempts(email_hash) values(p_email_hash);
 return true;
end $$;
create function public.manor_issue_signup_grant(p_email text) returns void language sql security definer set search_path='' as $$
 insert into manor_private.signup_grants(email,expires_at,consumed_at) values(lower(trim(p_email)),now()+interval '10 minutes',null) on conflict(email) do update set expires_at=excluded.expires_at,consumed_at=null
$$;
revoke all on function public.manor_signup_attempt(text),public.manor_issue_signup_grant(text) from public,anon,authenticated;
grant execute on function public.manor_signup_attempt(text),public.manor_issue_signup_grant(text) to service_role;

-- Hook payload is delivered by Auth, not accepted from a browser RPC.
create function manor_private.before_user_created(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare signup_email text:=lower(event->'user'->>'email'); accepted text;
begin
 -- Auth external.go sets EmailVerified from provider data, then hooks.go creates
 -- this not-yet-persisted User from that data. This is not JWT/user-editable metadata.
 if event->'user'->'app_metadata'->>'provider' is distinct from 'google' or event->'user'->'user_metadata'->>'email_verified' is distinct from 'true' then
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Sign in with Google to use Manor'));
 end if;
 update manor_private.signup_grants set consumed_at=clock_timestamp() where signup_grants.email=signup_email and expires_at>clock_timestamp() and consumed_at is null returning signup_grants.email into accepted;
 if accepted is null then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Complete the signup password step for this Google email first')); end if;
 return '{}'::jsonb;
end $$;
revoke all on function manor_private.before_user_created(jsonb) from public,anon,authenticated;
grant usage on schema manor_private to supabase_auth_admin;
grant execute on function manor_private.before_user_created(jsonb) to supabase_auth_admin;
