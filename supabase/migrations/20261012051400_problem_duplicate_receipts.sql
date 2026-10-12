-- Qualify duplicate receipt rows independently of the command payload parameter.
begin;
create or replace function manor_private.problem_duplicate_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
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
 return jsonb_build_object('canonical',(select to_jsonb(source)-'user_id' from public.leetcode_problems source where source.user_id=auth.uid() and source.id=canonical.id),'sources',(select jsonb_agg(to_jsonb(source)-'user_id' order by source.id) from public.leetcode_problems source where source.user_id=auth.uid() and source.id=any(ids)),'ungrouped_id',case when op='unmerge_problem_duplicate' then alias_row.id end);
end $$;
alter function manor_private.problem_duplicate_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.problem_duplicate_command(text,jsonb) from public;
commit;
