-- Account writes check ownership before taking row locks. An account's row lock passes through the update policy,
-- which hides catalog rows, so locking first made a catalog ID look missing instead of read-only. Catalog commands
-- clear the account command identity so a catalog write never records account action history.
begin;
create or replace function manor_private.save_problem(p jsonb,p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
declare existing public.leetcode_problems; previous public.problem_content_versions; rid text:=p->>'id'; content jsonb:=p->'content'; next_version integer; result jsonb;
 topics_value text[]; companies_value text[]; tags_value text[]; collections_value text[]; matched_id text; testset_result jsonb; source_metadata_value jsonb;
begin
 if p_owner is null and auth.uid() is not null then raise exception using errcode='42501',message='Manor catalog problems are read-only.'; end if;
 if p_owner is not null and p_owner is distinct from auth.uid() then raise exception using errcode='42501',message='Problems are saved by their own account'; end if;
 if length(rid) not between 1 and 200 or rid is null then raise exception 'A problem requires a stable ID from 1 to 200 characters'; end if;
 if p->>'source_type' is null or p->>'source_type' not in ('stock','imported','custom') then raise exception 'Choose a supported problem source type'; end if;
 if p_owner is not null and p->>'source_type'<>'custom' then raise exception using errcode='42501',message='Manor catalog problems are read-only. Save your own problems with source_type custom.'; end if;
 if p_owner is null and p->>'source_type'='custom' then raise exception 'Catalog problems are stock or imported; custom problems belong to an account'; end if;
 if p->>'external_key' is not null then
  if p_owner is null then
   select id into matched_id from public.leetcode_problems where user_id is null and source_type=p->>'source_type' and external_key=p->>'external_key' for update;
  else
   select id into matched_id from public.leetcode_problems where user_id=p_owner and source_type=p->>'source_type' and external_key=p->>'external_key' for update;
  end if;
  if matched_id is not null then rid:=matched_id; end if;
 end if;
 -- Ownership is checked before locking: an account's row lock passes through its update policy, which hides catalog rows.
 select * into existing from public.leetcode_problems where id=rid;
 perform manor_private.require_problem_owner(existing,p_owner);
 select * into existing from public.leetcode_problems where id=rid for update;
 source_metadata_value:=coalesce(p->'source_metadata',existing.source_metadata,'{}'::jsonb);
 perform manor_private.validate_problem_source_metadata(source_metadata_value);
 if length(btrim(p->>'name')) not between 1 and 500 or jsonb_typeof(p->'name') is distinct from 'string' then raise exception 'A problem name requires 1 to 500 characters'; end if;
 if p->>'kind' is null or p->>'kind' not in ('coding','system_design','behavioral','other') then raise exception 'Choose a supported problem kind'; end if;
 if not(p?'difficulty') or (p->>'difficulty' is not null and p->>'difficulty' not in ('Easy','Medium','Hard')) then raise exception 'Difficulty must be Easy, Medium, Hard, or null'; end if;
 if not(p?'source_url') or (p->>'source_url' is not null and (length(p->>'source_url')>2000 or p->>'source_url' !~ '^https?://')) then raise exception 'Source URL must be null or a bounded HTTP URL'; end if;
 if not(p?'external_key') or (p->>'external_key' is not null and length(p->>'external_key') not between 1 and 200) then raise exception 'External key must be null or a bounded stable identifier'; end if;
 topics_value:=manor_private.problem_labels(p->'topics',100,100);
 companies_value:=manor_private.problem_labels(p->'companies',1000,100);
 tags_value:=manor_private.problem_labels(p->'tags',100,100);
 collections_value:=manor_private.problem_labels(p->'collections',100,100);
 if not(p?'content') or (content<>'null'::jsonb and jsonb_typeof(content) is distinct from 'object') then raise exception 'Supply content or null to preserve existing content'; end if;
 next_version:=coalesce(existing.content_version,0);
 if content<>'null'::jsonb then
  perform manor_private.validate_problem_content(content);
  -- Content edits that omit the interface keep the current one; an explicit null removes it.
  content:=content||jsonb_build_object('interface',case when content ? 'interface' then content->'interface' else coalesce((select c.interface from public.problem_content_versions c where c.problem_id=rid and c.version=next_version),'null'::jsonb) end);
  select * into previous from public.problem_content_versions where problem_id=rid and version=next_version;
 end if;
 -- Imports retried with a new command ID may identify an unchanged source again without overwriting edits.
 if existing.id is not null and (p->>'expected_revision')::bigint=0 and matched_id is not null and
  existing.source_metadata=source_metadata_value and existing.name=btrim(p->>'name') and existing.difficulty is not distinct from p->>'difficulty' and existing.kind=p->>'kind' and existing.topics=topics_value and existing.companies=companies_value and existing.tags=tags_value and existing.collections=collections_value and existing.source_url is not distinct from p->>'source_url' and
  (content='null'::jsonb or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code,'interface',coalesce(previous.interface,'null'::jsonb))=content) and not(p?'testset') then
  return to_jsonb(existing)||jsonb_build_object('import_outcome','unchanged');
 end if;
 perform manor_private.require_revision(existing.revision,(p->>'expected_revision')::bigint,to_jsonb(existing));
 if content<>'null'::jsonb and (previous.version is null or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code,'interface',coalesce(previous.interface,'null'::jsonb)) is distinct from content) then next_version:=next_version+1; end if;
 -- A new statement version has no testset yet, so its grader is unknown until one is saved.
 insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order,kind,topics,companies,tags,collections,source_url,source_type,external_key,content_available,content_version,source_metadata)
 values(p_owner,rid,coalesce(topics_value[1],'General'),btrim(p->>'name'),p->>'difficulty',coalesce(existing.curriculum_order,0),p->>'kind',topics_value,companies_value,tags_value,collections_value,p->>'source_url',p->>'source_type',p->>'external_key',next_version>0,next_version,source_metadata_value)
 on conflict(id) do update set topic=case when public.leetcode_problems.source_type='stock' then public.leetcode_problems.topic else excluded.topic end,name=excluded.name,difficulty=excluded.difficulty,kind=excluded.kind,topics=excluded.topics,companies=excluded.companies,tags=excluded.tags,collections=excluded.collections,source_url=excluded.source_url,source_type=excluded.source_type,external_key=excluded.external_key,content_available=excluded.content_available,content_version=excluded.content_version,source_metadata=excluded.source_metadata,
  grading_version=case when excluded.content_version=public.leetcode_problems.content_version then public.leetcode_problems.grading_version end,revision=public.leetcode_problems.revision+1,updated_at=clock_timestamp()
  where public.leetcode_problems.user_id is not distinct from excluded.user_id
 returning to_jsonb(leetcode_problems.*) into result;
 if result is null then raise exception using errcode='23505',message='Problem ID '||rid||' was taken by another owner while saving; choose a new ID'; end if;
 if content<>'null'::jsonb and next_version>coalesce(previous.version,0) then
  insert into public.problem_content_versions(problem_id,version,statement_markdown,examples,hints,solution_markdown,starter_code,interface)
  values(rid,next_version,content->>'statement_markdown',content->'examples',array(select jsonb_array_elements_text(content->'hints')),content->>'solution_markdown',content->'starter_code',nullif(content->'interface','null'::jsonb));
 end if;
 if p?'testset' then
  if p->>'kind'<>'coding' or next_version=0 then raise exception 'A testset requires a coding problem with a saved statement'; end if;
  execute 'select manor_private.save_problem_testset($1)' into testset_result using p->'testset'||jsonb_build_object('problemId',rid,'contentVersion',next_version);
  -- Saving a grader moves the problem's grading version and revision.
  select to_jsonb(r) into result from public.leetcode_problems r where r.id=rid;
  result:=result||jsonb_build_object('testset',testset_result);
 end if;
 return result||jsonb_build_object('import_outcome',case when existing.id is null then 'created' else 'updated' end);
end $$;

create or replace function manor_private.problem_duplicate_group(op text,p jsonb,p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
declare canonical public.leetcode_problems; alias_row public.leetcode_problems; candidate jsonb; ids text[]; alias_ids text[]; key text; combined integer;
begin
 if op='merge_problem_duplicates' then
  if jsonb_typeof(p->'aliases') is distinct from 'array' or jsonb_array_length(p->'aliases') not between 1 and 99 then raise exception 'A duplicate merge requires 1 to 99 reviewed source records'; end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 500 then raise exception 'A duplicate merge requires a reviewed problem title'; end if;
  if jsonb_typeof(p->'reason') is distinct from 'string' or length(btrim(p->>'reason')) not between 1 and 2000 then raise exception 'A duplicate merge requires functional-equivalence evidence'; end if;
  alias_ids:=array(select value->>'id' from jsonb_array_elements(p->'aliases'));
  if exists(select 1 from unnest(alias_ids) id where id is null or length(id) not between 1 and 200 or id=p->>'id') or cardinality(alias_ids)<>(select count(distinct id) from unnest(alias_ids) id) then raise exception 'Duplicate source IDs must be distinct and exclude the canonical ID'; end if;
  ids:=alias_ids||array[p->>'id'];
  perform id from public.leetcode_problems where id=any(ids) order by id for update;
  select * into canonical from public.leetcode_problems where id=p->>'id';
  if canonical.id is null then raise exception using errcode='P0002',message='Canonical problem '||(p->>'id')||' does not exist'; end if;
  perform manor_private.require_problem_owner(canonical,p_owner);
  perform manor_private.require_revision(canonical.revision,(p->>'expected_revision')::bigint,to_jsonb(canonical));
  if canonical.canonical_problem_id is not null then raise exception 'Choose an ungrouped canonical problem'; end if;
  if (select count(*) from public.leetcode_problems where id=canonical.id or canonical_problem_id=canonical.id)+cardinality(alias_ids)>100 then raise exception 'A duplicate group supports at most 100 retained source records'; end if;
  for candidate in select value from jsonb_array_elements(p->'aliases') loop
   select * into alias_row from public.leetcode_problems where id=candidate->>'id';
   if alias_row.id is null then raise exception using errcode='P0002',message='Duplicate source '||(candidate->>'id')||' does not exist'; end if;
   perform manor_private.require_problem_owner(alias_row,p_owner);
   perform manor_private.require_revision(alias_row.revision,(candidate->>'expected_revision')::bigint,to_jsonb(alias_row));
   if alias_row.source_type not in ('imported','custom') or alias_row.canonical_problem_id is not null or alias_row.kind<>canonical.kind then raise exception 'Duplicate sources must be ungrouped imported or custom problems with the canonical problem''s kind; stock problems are never sources'; end if;
   if exists(select 1 from public.leetcode_problems where canonical_problem_id=alias_row.id) then raise exception 'Unmerge the other duplicate group before regrouping its sources'; end if;
   if alias_row.grading_version is not null and canonical.grading_version is null then raise exception 'Choose the source with a current verified grader as the canonical problem'; end if;
  end loop;
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select count(distinct label) from public.leetcode_problems p cross join lateral unnest(p.%I) label where id=any($1) or canonical_problem_id=$2',key) into combined using ids,canonical.id;
   if combined>(case when key='companies' then 1000 else 100 end) then raise exception 'Combined % labels exceed the catalog limit; keep sources separate or revise those labels first',key; end if;
  end loop;
  update public.leetcode_problems set source_name=coalesce(source_name,name),name=btrim(p->>'name'),revision=revision+1,updated_at=clock_timestamp() where id=canonical.id;
  update public.leetcode_problems set canonical_problem_id=canonical.id,source_name=coalesce(source_name,name),duplicate_reason=btrim(p->>'reason'),revision=revision+1,updated_at=clock_timestamp() where id=any(alias_ids);
 elsif op='unmerge_problem_duplicate' then
  select * into alias_row from public.leetcode_problems where id=p->>'id';
  perform manor_private.require_problem_owner(alias_row,p_owner);
  select * into alias_row from public.leetcode_problems where id=p->>'id' for update;
  if alias_row.id is null or alias_row.canonical_problem_id is null then raise exception using errcode='P0002',message='Problem '||(p->>'id')||' is not a grouped source'; end if;
  ids:=array[alias_row.id,alias_row.canonical_problem_id];
  select * into canonical from public.leetcode_problems where id=alias_row.canonical_problem_id for update;
  perform manor_private.require_revision(alias_row.revision,(p->>'expected_revision')::bigint,to_jsonb(alias_row));
  perform manor_private.require_revision(canonical.revision,(p->>'canonical_expected_revision')::bigint,to_jsonb(canonical));
  update public.leetcode_problems set canonical_problem_id=null,duplicate_reason=null,revision=revision+1,updated_at=clock_timestamp() where id=alias_row.id;
  update public.leetcode_problems set revision=revision+1,updated_at=clock_timestamp() where id=canonical.id;
 else raise exception 'Unsupported duplicate operation: %',op;
 end if;
 return jsonb_build_object('canonical',(select to_jsonb(source)-'user_id' from public.leetcode_problems source where source.id=canonical.id),'sources',(select jsonb_agg(to_jsonb(source)-'user_id' order by source.id) from public.leetcode_problems source where source.id=any(ids)),'ungrouped_id',case when op='unmerge_problem_duplicate' then alias_row.id end);
end $$;
create or replace function manor_private.catalog_command(p_command_id uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt manor_private.catalog_receipts; fingerprint text; result jsonb; item jsonb; outcomes jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='Manor catalog problems change only through Manor import tooling'; end if;
 if p_command_id is null or p_operation is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'A catalog command requires an ID, operation, and object input'; end if;
 perform pg_advisory_xact_lock(hashtext('manor-catalog'));
 -- Catalog writes carry no account action history, even inside a transaction that ran an account command.
 perform set_config('manor.command_id','',true);
 fingerprint:=encode(sha256(convert_to(p_operation||p_input::text,'UTF8')),'hex');
 select * into receipt from manor_private.catalog_receipts where command_id=p_command_id;
 if found then
  if receipt.input_hash<>fingerprint then raise exception using errcode='22023',message='Catalog command ID was already used with different input'; end if;
  return receipt.response||jsonb_build_object('replayed',true);
 end if;
 if p_operation='save_problem' then result:=manor_private.save_problem(p_input,null);
 elsif p_operation='import_problems' then
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') not between 1 and 100 then raise exception 'Import requires 1 to 100 problems per atomic batch'; end if;
  for item in select value from jsonb_array_elements(p_input->'items') loop
   result:=manor_private.save_problem(item,null);
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',result->>'id','revision',result->'revision','content_version',result->'content_version','outcome',result->>'import_outcome'));
  end loop;
  result:=jsonb_build_object('items',outcomes,'count',jsonb_array_length(outcomes));
 elsif p_operation in ('merge_problem_duplicates','unmerge_problem_duplicate') then result:=manor_private.problem_duplicate_group(p_operation,p_input,null);
 elsif p_operation='delete_problem' then result:=manor_private.delete_catalog_problems(p_command_id,p_input);
 else raise exception using errcode='22023',message='Unsupported Manor catalog operation: '||p_operation;
 end if;
 result:=jsonb_build_object('command_id',p_command_id,'operation',p_operation,'record',result,'replayed',false);
 insert into manor_private.catalog_receipts(command_id,operation,input_hash,response) values(p_command_id,p_operation,fingerprint,result);
 return result;
end $$;

commit;
