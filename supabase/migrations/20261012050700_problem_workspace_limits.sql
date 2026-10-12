-- Durable source limits match execution limits; readable content does not imply a verified judge.
begin;
alter table public.problem_code_drafts drop constraint problem_code_drafts_source_check;
alter table public.problem_code_drafts add constraint problem_code_drafts_source_check check(octet_length(source)<=262144);
create or replace function manor_private.problem_library_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; result jsonb; outcomes jsonb:='[]'; draft public.problem_code_drafts; current_version integer; view_row public.saved_problem_views; filters jsonb; sort_item jsonb; columns_value text[]; key text;
begin
 if op='save_problem_draft' then
  if p->>'language' is null or p->>'language' not in ('cpp','c','python','javascript','java','go') or jsonb_typeof(p->'source') is distinct from 'string' or octet_length(p->>'source')>262144 then raise exception 'Code draft requires a supported language and source of at most 262144 UTF-8 bytes'; end if;
  select content_version into current_version from public.leetcode_problems where user_id=auth.uid() and id=p->>'problem_id' and kind='coding';
  if current_version is null or current_version=0 or current_version is distinct from (p->>'content_version')::integer then raise exception using errcode='PT409',message='Problem statement changed. Reload before saving this code draft.'; end if;
  select * into draft from public.problem_code_drafts where user_id=auth.uid() and problem_id=p->>'problem_id' and language=p->>'language' for update;
  perform manor_private.require_revision(draft.revision,(p->>'expected_revision')::bigint,to_jsonb(draft));
  if exists(select 1 from public.problem_code_drafts where user_id=auth.uid() and id=p->>'id' and (problem_id<>p->>'problem_id' or language<>p->>'language')) then raise exception 'Code draft ID belongs to another problem or language'; end if;
  if draft.id is not null and draft.id<>p->>'id' then raise exception 'Code draft identity does not match the existing problem draft'; end if;
  insert into public.problem_code_drafts(user_id,id,problem_id,language,content_version,source)
  values(auth.uid(),p->>'id',p->>'problem_id',p->>'language',(p->>'content_version')::integer,p->>'source')
  on conflict(user_id,id) do update set content_version=excluded.content_version,source=excluded.source,revision=public.problem_code_drafts.revision+1,updated_at=clock_timestamp()
  returning to_jsonb(problem_code_drafts.*) into result;
  return result;
 elsif op='save_problem' then return manor_private.save_problem(p);
 elsif op='import_problems' then
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 100 then raise exception 'Import requires 1 to 100 problems per atomic batch'; end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   result:=manor_private.save_problem(item);
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',result->>'id','revision',result->'revision','content_version',result->'content_version','outcome',result->>'import_outcome'));
  end loop;
  return jsonb_build_object('items',outcomes,'count',jsonb_array_length(outcomes));
 elsif op in ('save_problem_view','delete_problem_view') then
  select * into view_row from public.saved_problem_views where user_id=auth.uid() and id=p->>'id' for update;
  perform manor_private.require_revision(view_row.revision,(p->>'expected_revision')::bigint,to_jsonb(view_row));
  if op='delete_problem_view' then
   if view_row.id is null then raise exception 'Saved problem view is unavailable'; end if;
   delete from public.saved_problem_views where user_id=auth.uid() and id=view_row.id;
   return jsonb_build_object('id',view_row.id,'deleted',true);
  end if;
  filters:=p->'filters';
  if jsonb_typeof(filters) is distinct from 'object' or jsonb_typeof(filters->'search') is distinct from 'string' or length(filters->>'search')>500 then raise exception 'Saved view filters require a bounded search string'; end if;
  foreach key in array array['kinds','difficulties','topics','companies','tags','collections','sourceTypes','statuses'] loop perform manor_private.problem_labels(filters->key,100,100); end loop;
  if exists(select 1 from jsonb_array_elements_text(filters->'kinds') value where value not in ('coding','system_design','behavioral','other')) or exists(select 1 from jsonb_array_elements_text(filters->'difficulties') value where value not in ('Easy','Medium','Hard')) or exists(select 1 from jsonb_array_elements_text(filters->'sourceTypes') value where value not in ('stock','imported','custom')) or exists(select 1 from jsonb_array_elements_text(filters->'statuses') value where value not in ('unattempted','attempted','solved')) then raise exception 'Saved view filters contain unsupported values'; end if;
  if not(filters?'hasContent') or jsonb_typeof(filters->'hasContent') not in ('boolean','null') then raise exception 'Saved view content filter must be true, false, or null'; end if;
  if jsonb_typeof(p->'sort') is distinct from 'array' or jsonb_array_length(p->'sort') not between 1 and 5 then raise exception 'Saved view requires 1 to 5 sort rules'; end if;
  for sort_item in select value from jsonb_array_elements(p->'sort') loop
   if sort_item->>'field' is null or sort_item->>'field' not in ('name','difficulty','kind','createdAt','updatedAt') or sort_item->>'direction' is null or sort_item->>'direction' not in ('asc','desc') then raise exception 'Saved view sort rule is invalid'; end if;
  end loop;
  columns_value:=manor_private.problem_labels(p->'visible_columns',7,100);
  if cardinality(columns_value)=0 or exists(select 1 from unnest(columns_value) value where value not in ('difficulty','kind','topics','companies','tags','collections','status')) then raise exception 'Saved view columns are invalid'; end if;
  if not(p?'group_by') or (p->>'group_by' is not null and p->>'group_by' not in ('topic','company','difficulty','kind','collection')) then raise exception 'Saved view grouping is invalid'; end if;
  insert into public.saved_problem_views(user_id,id,name,filters,sort,group_by,visible_columns)
  values(auth.uid(),p->>'id',btrim(p->>'name'),filters,p->'sort',p->>'group_by',columns_value)
  on conflict(user_id,id) do update set name=excluded.name,filters=excluded.filters,sort=excluded.sort,group_by=excluded.group_by,visible_columns=excluded.visible_columns,revision=public.saved_problem_views.revision+1,updated_at=clock_timestamp()
  returning to_jsonb(saved_problem_views.*) into result;
  return result;
 end if;
 raise exception 'Unsupported problem library operation: %',op;
end $$;

create or replace function public.manor_problem_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare take integer:=coalesce((p_input->>'limit')::integer,50); after_id text:=coalesce(p_input->>'cursor',''); items jsonb; problem jsonb; content jsonb; total bigint; can_grade boolean;
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
  can_grade:=problem->>'kind'='coding' and problem->>'source_type' in ('imported','custom') and exists(select 1 from manor_private.problem_testsets t where t.user_id=auth.uid() and t.problem_id=p_input->>'id' and t.content_version=(problem->>'content_version')::integer and jsonb_array_length(t.cases)>0);
  return jsonb_build_object('problem',problem,'content',content,'can_execute',can_grade or (problem->>'kind'='coding' and problem->>'source_type'='custom' and content is not null),'grading_available',can_grade);
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


commit;
