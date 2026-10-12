-- Close the retired private summary grant and report durable runner status consistently.
-- Metadata pagination totals describe the complete filtered set rather than the account catalog.
revoke execute on function manor_private.leetcode_summary() from authenticated,anon,public;

create or replace function public.manor_problem_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare take integer:=coalesce((p_input->>'limit')::integer,50); after_id text:=coalesce(p_input->>'cursor',''); items jsonb; problem jsonb; content jsonb; total bigint;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before reading problems'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(false) then raise exception using errcode='42501',message='This agent is not authorized to read'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>10000 or take not between 1 and 200 then raise exception 'Problem queries require bounded object input and limit 1 to 200'; end if;
 if p_query='read_problem_draft' then
  if p_input->>'language' is null or p_input->>'language' not in ('cpp','c','python','javascript','java','go') then raise exception 'Choose a supported draft language'; end if;
  select to_jsonb(d)-'user_id' into problem from public.problem_code_drafts d where user_id=auth.uid() and problem_id=p_input->>'problem_id' and language=p_input->>'language';
  return problem;
 elsif p_query='read_problem' then
  select to_jsonb(p)-'user_id'||jsonb_build_object('status',case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else p.practice_status end) into problem from public.leetcode_problems p where user_id=auth.uid() and id=p_input->>'id';
  if problem is null then raise exception using errcode='P0002',message='Problem does not exist or is not owned by this account'; end if;
  select to_jsonb(c)-'user_id' into content from public.problem_content_versions c where user_id=auth.uid() and problem_id=p_input->>'id' and version=(problem->>'content_version')::integer;
  return jsonb_build_object('problem',problem,'content',content);
 elsif p_query='list_problem_views' then
  select coalesce(jsonb_agg(to_jsonb(v)-'user_id' order by id),'[]') into items from (select * from public.saved_problem_views where user_id=auth.uid() and id>after_id order by id limit take) v;
 elsif p_query='query_problems' then
  if p_input->>'status' is not null and p_input->>'status' not in ('unattempted','attempted','solved') then raise exception 'Problem status filter is invalid'; end if;
  with candidates as materialized (
   select p.*,case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else p.practice_status end as status
   from public.leetcode_problems p where user_id=auth.uid()
   and (p_input->>'search' is null or name ilike '%'||(p_input->>'search')||'%')
   and (p_input->>'kind' is null or kind=p_input->>'kind')
   and (p_input->>'difficulty' is null or difficulty=p_input->>'difficulty')
   and (p_input->>'source_type' is null or source_type=p_input->>'source_type')
   and (p_input->>'topic' is null or p_input->>'topic'=any(topics))
   and (p_input->>'company' is null or p_input->>'company'=any(companies))
   and (p_input->>'tag' is null or p_input->>'tag'=any(tags))
   and (p_input->>'collection' is null or p_input->>'collection'=any(collections))
   and (not(p_input?'has_content') or content_available=(p_input->>'has_content')::boolean)
  ), matched as materialized (
   select * from candidates where p_input->>'status' is null or status=p_input->>'status'
  ), page as (
   select * from matched where id>after_id order by id limit take
  )
  select coalesce((select jsonb_agg(to_jsonb(p)-'user_id' order by id) from page p),'[]'),(select count(*) from matched)
  into items,total;
 else raise exception 'Unsupported problem query: %',p_query;
 end if;
 return jsonb_build_object('items',items,'total',total,'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'id' end);
end $$;
alter function public.manor_problem_query(text,jsonb) owner to manor_commands;
revoke all on function public.manor_problem_query(text,jsonb) from public,anon;
grant execute on function public.manor_problem_query(text,jsonb) to authenticated;

