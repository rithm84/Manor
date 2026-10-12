-- Reversible imported duplicate groups retain source identities and protected work.
begin;
grant create on schema manor_private,public to manor_commands;
alter table public.leetcode_problems
 add column canonical_problem_id text,
 add column source_name text check(source_name is null or length(source_name) between 1 and 500),
 add column duplicate_reason text check(duplicate_reason is null or length(duplicate_reason) between 1 and 2000),
 add constraint problem_canonical_owner foreign key(user_id,canonical_problem_id) references public.leetcode_problems(user_id,id),
 add constraint problem_canonical_not_self check(canonical_problem_id is null or canonical_problem_id<>id),
 add constraint problem_alias_imported check(canonical_problem_id is null or source_type='imported');
create index problem_catalog_canonical on public.leetcode_problems(user_id,canonical_problem_id,id);

create function manor_private.guard_problem_canonical() returns trigger language plpgsql security definer set search_path='' as $$
declare target public.leetcode_problems; group_id text; key text; combined integer;
begin
 if new.canonical_problem_id is not null then
  select * into target from public.leetcode_problems where user_id=new.user_id and id=new.canonical_problem_id for update;
  if target.id is null or target.source_type<>'imported' or target.canonical_problem_id is not null or target.kind<>new.kind then raise exception 'A duplicate must reference an account-owned imported canonical problem'; end if;
  if exists(select 1 from public.leetcode_problems where user_id=new.user_id and canonical_problem_id=new.id) then raise exception 'Duplicate groups must stay flat; unmerge this group before regrouping it'; end if;
 elsif new.source_type<>'imported' and exists(select 1 from public.leetcode_problems where user_id=new.user_id and canonical_problem_id=new.id) then
  raise exception 'An imported canonical problem with retained sources cannot become stock or custom';
 end if;
 group_id:=coalesce(new.canonical_problem_id,new.id);
 if exists(select 1 from public.leetcode_problems where user_id=new.user_id and canonical_problem_id=group_id and id<>new.id and kind<>new.kind) then raise exception 'Retained duplicate sources must have the same kind'; end if;
 if new.canonical_problem_id is not null or exists(select 1 from public.leetcode_problems where user_id=new.user_id and canonical_problem_id=new.id) then
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select count(distinct label) from (select unnest(p.%I) label from public.leetcode_problems p where user_id=$1 and id<>$2 and (id=$3 or canonical_problem_id=$3) union all select jsonb_array_elements_text($4->$5)) labels',key)
    into combined using new.user_id,new.id,group_id,to_jsonb(new),key;
   if combined>(case when key='companies' then 1000 else 100 end) then raise exception 'Combined % labels exceed the duplicate-group catalog limit',key; end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function manor_private.guard_problem_canonical() from public;
create trigger problem_canonical_guard before insert or update on public.leetcode_problems for each row execute function manor_private.guard_problem_canonical();

create function manor_private.guard_problem_practice_target() returns trigger language plpgsql security definer set search_path='' as $$
declare target text;
begin
 select canonical_problem_id into target from public.leetcode_problems where user_id=new.user_id and id=new.problem_id for update;
 if not found then raise exception using errcode='P0002',message='The practice problem does not exist in this account'; end if;
 if target is not null then raise exception using errcode='PT409',message='This source is grouped with problem '||target||'. Open the canonical problem before saving practice work.'; end if;
 return new;
end $$;
revoke all on function manor_private.guard_problem_practice_target() from public;
create trigger problem_canonical_practice before insert or update on public.leetcode_attempts for each row execute function manor_private.guard_problem_practice_target();
create trigger problem_canonical_practice before insert or update on public.problem_code_drafts for each row execute function manor_private.guard_problem_practice_target();
create trigger problem_canonical_practice before insert or update on public.problem_submissions for each row execute function manor_private.guard_problem_practice_target();
create trigger problem_canonical_practice before insert or update on manor_private.problem_editor_sessions for each row execute function manor_private.guard_problem_practice_target();

create function manor_private.problem_has_protected_work(rid text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.leetcode_attempts where user_id=auth.uid() and problem_id=rid)
 or exists(select 1 from public.problem_code_drafts where user_id=auth.uid() and problem_id=rid)
 or exists(select 1 from public.problem_submissions where user_id=auth.uid() and problem_id=rid)
 or exists(select 1 from manor_private.problem_editor_sessions where user_id=auth.uid() and problem_id=rid and expires_at>clock_timestamp());
$$;
revoke all on function manor_private.problem_has_protected_work(text) from public;
grant execute on function manor_private.problem_has_protected_work(text) to manor_commands;

create function manor_private.problem_duplicate_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare canonical public.leetcode_problems; alias_row public.leetcode_problems; candidate jsonb; ids text[]; alias_ids text[]; key text; combined integer;
begin
 if op='merge_problem_duplicates' then
  if jsonb_typeof(p->'aliases') is distinct from 'array' or jsonb_array_length(p->'aliases') not between 1 and 99 then raise exception 'A duplicate merge requires 1 to 99 reviewed source records'; end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 500 then raise exception 'A duplicate merge requires a reviewed problem title'; end if;
  if jsonb_typeof(p->'reason') is distinct from 'string' or length(btrim(p->>'reason')) not between 1 and 2000 then raise exception 'A duplicate merge requires functional-equivalence evidence'; end if;
  alias_ids:=array(select value->>'id' from jsonb_array_elements(p->'aliases'));
  if exists(select 1 from unnest(alias_ids) id where id is null or length(id) not between 1 and 200 or id=p->>'id') or cardinality(alias_ids)<>(select count(distinct id) from unnest(alias_ids) id) then raise exception 'Duplicate source IDs must be distinct and exclude the canonical ID'; end if;
  ids:=alias_ids||array[p->>'id'];
  perform id from public.leetcode_problems where user_id=auth.uid() and id=any(ids) order by id for update;
  select * into canonical from public.leetcode_problems where user_id=auth.uid() and id=p->>'id';
  if canonical.id is null then raise exception using errcode='P0002',message='Canonical problem is not owned by this account'; end if;
  perform manor_private.require_revision(canonical.revision,(p->>'expected_revision')::bigint,to_jsonb(canonical));
  if canonical.source_type<>'imported' or canonical.canonical_problem_id is not null then raise exception 'Choose an imported canonical problem, keeping stock and custom problems separate'; end if;
  if (select count(*) from public.leetcode_problems where user_id=auth.uid() and (id=canonical.id or canonical_problem_id=canonical.id))+cardinality(alias_ids)>100 then raise exception 'A duplicate group supports at most 100 retained source records'; end if;
  for candidate in select value from jsonb_array_elements(p->'aliases') loop
   select * into alias_row from public.leetcode_problems where user_id=auth.uid() and id=candidate->>'id';
   if alias_row.id is null then raise exception using errcode='P0002',message='Duplicate source is not owned by this account'; end if;
   perform manor_private.require_revision(alias_row.revision,(candidate->>'expected_revision')::bigint,to_jsonb(alias_row));
   if alias_row.source_type<>'imported' or alias_row.canonical_problem_id is not null or alias_row.kind<>canonical.kind then raise exception 'Duplicate sources must be ungrouped imported problems with the same kind'; end if;
   if exists(select 1 from public.leetcode_problems where user_id=auth.uid() and canonical_problem_id=alias_row.id) then raise exception 'Unmerge the other duplicate group before regrouping its sources'; end if;
   if manor_private.problem_has_protected_work(alias_row.id) then raise exception using errcode='PT409',message='Source '||alias_row.id||' has protected practice work or an open editor. Keep it separate until that work is explicitly resolved.'; end if;
   if exists(select 1 from manor_private.problem_testsets where user_id=auth.uid() and problem_id=alias_row.id and content_version=alias_row.content_version) and not exists(select 1 from manor_private.problem_testsets where user_id=auth.uid() and problem_id=canonical.id and content_version=canonical.content_version) then raise exception 'Choose the source with a current verified grader as the canonical problem'; end if;
  end loop;
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select count(distinct label) from public.leetcode_problems p cross join lateral unnest(p.%I) label where user_id=auth.uid() and (id=any($1) or canonical_problem_id=$2)',key) into combined using ids,canonical.id;
   if combined>(case when key='companies' then 1000 else 100 end) then raise exception 'Combined % labels exceed the catalog limit; keep sources separate or revise those labels first',key; end if;
  end loop;
  update public.leetcode_problems set source_name=coalesce(source_name,name),name=btrim(p->>'name'),revision=revision+1,updated_at=clock_timestamp() where user_id=auth.uid() and id=canonical.id;
  update public.leetcode_problems set canonical_problem_id=canonical.id,source_name=coalesce(source_name,name),duplicate_reason=btrim(p->>'reason'),revision=revision+1,updated_at=clock_timestamp() where user_id=auth.uid() and id=any(alias_ids);
 elsif op='unmerge_problem_duplicate' then
  select * into alias_row from public.leetcode_problems where user_id=auth.uid() and id=p->>'id' for update;
  if alias_row.id is null or alias_row.canonical_problem_id is null then raise exception using errcode='P0002',message='This account-owned problem is not a grouped source'; end if;
  ids:=array[alias_row.id,alias_row.canonical_problem_id];
  select * into canonical from public.leetcode_problems where user_id=auth.uid() and id=alias_row.canonical_problem_id for update;
  perform manor_private.require_revision(alias_row.revision,(p->>'expected_revision')::bigint,to_jsonb(alias_row));
  perform manor_private.require_revision(canonical.revision,(p->>'canonical_expected_revision')::bigint,to_jsonb(canonical));
  update public.leetcode_problems set canonical_problem_id=null,duplicate_reason=null,revision=revision+1,updated_at=clock_timestamp() where user_id=auth.uid() and id=alias_row.id;
  update public.leetcode_problems set revision=revision+1,updated_at=clock_timestamp() where user_id=auth.uid() and id=canonical.id;
 else raise exception 'Unsupported duplicate operation: %',op;
 end if;
 return jsonb_build_object('canonical',(select to_jsonb(p)-'user_id' from public.leetcode_problems p where user_id=auth.uid() and id=canonical.id),'sources',(select jsonb_agg(to_jsonb(p)-'user_id' order by id) from public.leetcode_problems p where user_id=auth.uid() and id=any(ids)),'ungrouped_id',case when op='unmerge_problem_duplicate' then alias_row.id end);
end $$;
alter function manor_private.problem_duplicate_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.problem_duplicate_command(text,jsonb) from public;

create function manor_private.problem_group_record(rid text) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.leetcode_problems; result jsonb; key text; labels jsonb;
begin
 select * into p from public.leetcode_problems where user_id=auth.uid() and id=rid;
 if p.id is null then raise exception using errcode='P0002',message='Problem is not owned by this account'; end if;
 result:=to_jsonb(p)-'user_id'||jsonb_build_object('status',case when exists(select 1 from public.leetcode_attempts where user_id=auth.uid() and problem_id=p.id) then 'solved' else p.practice_status end);
 if p.canonical_problem_id is null and exists(select 1 from public.leetcode_problems where user_id=auth.uid() and canonical_problem_id=p.id) then
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select coalesce(jsonb_agg(label order by label),''[]''::jsonb) from (select distinct unnest(p.%I) label from public.leetcode_problems p where user_id=auth.uid() and (id=$1 or canonical_problem_id=$1)) labels',key) into labels using p.id;
   result:=jsonb_set(result,array[key],labels);
  end loop;
 end if;
 return result;
end $$;
alter function manor_private.problem_group_record(text) owner to manor_commands;
revoke all on function manor_private.problem_group_record(text) from public;

create or replace function public.manor_problem_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare take integer:=coalesce((p_input->>'limit')::integer,50); after_id text:=coalesce(p_input->>'cursor',''); items jsonb; problem jsonb; content jsonb; total bigint; can_grade boolean; requested public.leetcode_problems; requested_content jsonb; sources jsonb; canonical_id text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before reading problems'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(false) then raise exception using errcode='42501',message='This agent is not authorized to read'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>10000 or take not between 1 and 200 then raise exception 'Problem queries require bounded object input and limit 1 to 200'; end if;
 if p_query='read_problem_draft' then
  if p_input->>'language' is null or p_input->>'language' not in ('cpp','c','python','javascript','java','go') then raise exception 'Choose a supported draft language'; end if;
  select to_jsonb(d)-'user_id' into problem from public.problem_code_drafts d where user_id=auth.uid() and problem_id=p_input->>'problem_id' and language=p_input->>'language';
  return problem;
 elsif p_query='read_problem' then
  select * into requested from public.leetcode_problems where user_id=auth.uid() and id=p_input->>'id';
  if requested.id is null then raise exception using errcode='P0002',message='Problem does not exist or is not owned by this account'; end if;
  canonical_id:=coalesce(requested.canonical_problem_id,requested.id);
  problem:=manor_private.problem_group_record(canonical_id);
  select to_jsonb(c)-'user_id' into content from public.problem_content_versions c where user_id=auth.uid() and problem_id=canonical_id and version=(problem->>'content_version')::integer;
  select to_jsonb(c)-'user_id' into requested_content from public.problem_content_versions c where user_id=auth.uid() and problem_id=requested.id and version=requested.content_version;
  select jsonb_agg((to_jsonb(p)-'user_id'||jsonb_build_object('status',case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else p.practice_status end)) order by p.id) into sources from public.leetcode_problems p where user_id=auth.uid() and (id=canonical_id or canonical_problem_id=canonical_id);
  can_grade:=problem->>'kind'='coding' and problem->>'source_type' in ('imported','custom') and exists(select 1 from manor_private.problem_testsets t where t.user_id=auth.uid() and t.problem_id=canonical_id and t.content_version=(problem->>'content_version')::integer);
  return jsonb_build_object('problem',problem,'content',content,'can_execute',can_grade or (problem->>'kind'='coding' and problem->>'source_type'='custom' and content is not null),'grading_available',can_grade,'requested_id',requested.id,'requested_problem',to_jsonb(requested)-'user_id'||jsonb_build_object('status',case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=requested.id) then 'solved' else requested.practice_status end),'requested_content',requested_content,'source_records',sources);
 elsif p_query='list_problem_views' then
  select coalesce(jsonb_agg(to_jsonb(v)-'user_id' order by id),'[]') into items from (select * from public.saved_problem_views where user_id=auth.uid() and id>after_id order by id limit take) v;
 elsif p_query='query_problems' then
  if p_input->>'status' is not null and p_input->>'status' not in ('unattempted','attempted','solved') then raise exception 'Problem status filter is invalid'; end if;
  if p_input->>'last_asked_since' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_since','precision','day'),false); end if;
  if p_input->>'last_asked_until' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_until','precision','day'),false); end if;
  if p_input->>'last_asked_since'>p_input->>'last_asked_until' then raise exception 'Recency date range is reversed'; end if;
  with candidates as materialized (
   select p.id,manor_private.problem_group_record(p.id) as record from public.leetcode_problems p where user_id=auth.uid() and canonical_problem_id is null
  ), matched as materialized (
   select c.* from candidates c where
   (p_input->>'search' is null or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and (s.id=c.id or s.canonical_problem_id=c.id) and (s.name ilike '%'||(p_input->>'search')||'%' or s.source_name ilike '%'||(p_input->>'search')||'%')))
   and (p_input->>'kind' is null or record->>'kind'=p_input->>'kind')
   and (p_input->>'difficulty' is null or record->>'difficulty'=p_input->>'difficulty')
   and (p_input->>'source_type' is null or record->>'source_type'=p_input->>'source_type')
   and (p_input->>'topic' is null or record->'topics' ? (p_input->>'topic'))
   and (p_input->>'company' is null or record->'companies' ? (p_input->>'company'))
   and (p_input->>'tag' is null or record->'tags' ? (p_input->>'tag'))
   and (p_input->>'collection' is null or record->'collections' ? (p_input->>'collection'))
   and (p_input->>'status' is null or record->>'status'=p_input->>'status')
   and (not(p_input?'has_content') or (record->>'content_available')::boolean=(p_input->>'has_content')::boolean)
   and ((p_input->>'last_asked_since' is null and p_input->>'last_asked_until' is null) or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and (s.id=c.id or s.canonical_problem_id=c.id)
    and (p_input->>'last_asked_since' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',true)>=(p_input->>'last_asked_since')::date)
    and (p_input->>'last_asked_until' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',false)<=(p_input->>'last_asked_until')::date)))
  ), page as (select * from matched where id>after_id order by id limit take)
  select coalesce((select jsonb_agg(record order by id) from page),'[]'),(select count(*) from matched) into items,total;
 else raise exception 'Unsupported problem query: %',p_query;
 end if;
 return jsonb_build_object('items',items,'total',total,'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'id' end);
end $$;
alter function public.manor_problem_query(text,jsonb) owner to manor_commands;
revoke all on function public.manor_problem_query(text,jsonb) from public,anon;
grant execute on function public.manor_problem_query(text,jsonb) to authenticated;
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
 elsif p_operation=any(array['commit_debrief','create_attempt','update_attempt','delete_attempt','save_mistake','delete_mistake','create_application','update_application','change_application_stage','trash_application','restore_application','create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','save_capture','save_weekly_review']) then result:=manor_private.domain_command(p_operation,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.command_receipts(user_id,command_id,operation,input_hash,response) values(auth.uid(),p_command_id,p_operation,fingerprint,result);
 return result;
end $$;

revoke create on schema manor_private,public from manor_commands;
commit;
