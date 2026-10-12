-- Filter canonical groups before computing bounded page projections.
begin;
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
  with matched as materialized (
   select p.id from public.leetcode_problems p where p.user_id=auth.uid() and p.canonical_problem_id is null
   and (p_input->>'search' is null or p.name ilike '%'||(p_input->>'search')||'%' or p.source_name ilike '%'||(p_input->>'search')||'%' or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and s.canonical_problem_id=p.id and (s.name ilike '%'||(p_input->>'search')||'%' or s.source_name ilike '%'||(p_input->>'search')||'%')))
   and (p_input->>'kind' is null or p.kind=p_input->>'kind')
   and (p_input->>'difficulty' is null or p.difficulty=p_input->>'difficulty')
   and (p_input->>'source_type' is null or p.source_type=p_input->>'source_type')
   and (p_input->>'topic' is null or p.topics @> array[p_input->>'topic'] or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and s.canonical_problem_id=p.id and s.topics @> array[p_input->>'topic']))
   and (p_input->>'company' is null or p.companies @> array[p_input->>'company'] or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and s.canonical_problem_id=p.id and s.companies @> array[p_input->>'company']))
   and (p_input->>'tag' is null or p.tags @> array[p_input->>'tag'] or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and s.canonical_problem_id=p.id and s.tags @> array[p_input->>'tag']))
   and (p_input->>'collection' is null or p.collections @> array[p_input->>'collection'] or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and s.canonical_problem_id=p.id and s.collections @> array[p_input->>'collection']))
   and (p_input->>'status' is null or (case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else p.practice_status end)=p_input->>'status')
   and (not(p_input?'has_content') or p.content_available=(p_input->>'has_content')::boolean)
   and ((p_input->>'last_asked_since' is null and p_input->>'last_asked_until' is null) or exists(select 1 from public.leetcode_problems s where s.user_id=auth.uid() and (s.id=p.id or s.canonical_problem_id=p.id)
    and (p_input->>'last_asked_since' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',true)>=(p_input->>'last_asked_since')::date)
    and (p_input->>'last_asked_until' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',false)<=(p_input->>'last_asked_until')::date)))
  ), page as (select * from matched where id>after_id order by id limit take)
  select coalesce((select jsonb_agg(manor_private.problem_group_record(id) order by id) from page),'[]'),(select count(*) from matched) into items,total;
 else raise exception 'Unsupported problem query: %',p_query;
 end if;
 return jsonb_build_object('items',items,'total',total,'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'id' end);
end $$;
alter function public.manor_problem_query(text,jsonb) owner to manor_commands;
revoke all on function public.manor_problem_query(text,jsonb) from public,anon;
grant execute on function public.manor_problem_query(text,jsonb) to authenticated;
commit;
