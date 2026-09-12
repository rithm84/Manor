grant select on public.job_listings to authenticated;
create function public.manor_query(p_query text,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source_table text; rows_json jsonb; row_limit int:=coalesce((p_input->>'limit')::int,50); cursor_value text:=coalesce(p_input->>'cursor',''); search_text text:=coalesce(p_input->>'search',''); life text:=coalesce(p_input->>'lifecycle','active');
begin
 if auth.uid() is null then raise exception 'Sign in before reading Manor'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or row_limit not between 1 and 200 or length(search_text)>500 then raise exception 'Queries require object input, limit 1 to 200, and search no longer than 500 characters'; end if;
 if p_query in ('read_note','read_note_version','read_note_blocks') and p_input->>'id' is null then raise exception 'A note ID is required'; end if;
 if p_query='read_note_blocks' and (jsonb_typeof(p_input->'block_ids') is distinct from 'array' or jsonb_array_length(p_input->'block_ids') not between 1 and 100) then raise exception 'Read 1 to 100 blocks'; end if;
 if p_query='query_action_history' then
  select coalesce(jsonb_agg(to_jsonb(e.*) order by id desc),'[]') into rows_json from (select * from public.action_events where user_id=auth.uid() and (cursor_value='' or id<cursor_value::bigint) and (not p_input?'object_type' or object_type=p_input->>'object_type') and (not p_input?'from' or occurred_at>=(p_input->>'from')::timestamptz) and (not p_input?'to' or occurred_at<(p_input->>'to')::timestamptz) order by id desc limit row_limit) e;
 elsif p_query='query_daily_records' then
  select coalesce(jsonb_agg(to_jsonb(e.*) order by date),'[]') into rows_json from (select * from public.mood_focus_entries where user_id=auth.uid() and (cursor_value='' or date>cursor_value::date) and (not p_input?'from' or date>=(p_input->>'from')::date) and (not p_input?'to' or date<=(p_input->>'to')::date) order by date limit row_limit) e;
 elsif p_query='list_note_versions' then
  select coalesce(jsonb_agg(to_jsonb(e.*) order by revision desc),'[]') into rows_json from (select note_id,revision,title,created_at from public.note_versions where user_id=auth.uid() and note_id=p_input->>'id' and (cursor_value='' or revision<cursor_value::bigint) order by revision desc limit row_limit) e;
 elsif p_query='read_note_version' then
  select jsonb_build_array(to_jsonb(v.*)) into rows_json from public.note_versions v where user_id=auth.uid() and note_id=p_input->>'id' and revision=(p_input->>'revision')::bigint;
 elsif p_query='read_note_blocks' then
  select jsonb_build_object('id',n.id,'revision',n.revision,'blocks',(select coalesce(jsonb_agg(manor_private.find_block(n.content_json,block_id)),'[]') from jsonb_array_elements_text(p_input->'block_ids') block_id)) into rows_json from public.note_pages n where user_id=auth.uid() and id=p_input->>'id' and status<>'trash';
  if rows_json is null then raise exception 'Note is unavailable'; end if;
  return rows_json;
 elsif p_query='search' then
  select coalesce(jsonb_agg(to_jsonb(r.*) order by module,id),'[]') into rows_json from (select * from (
   select 'tasks' module,id,title,revision,left(title,300) snippet from public.tasks where user_id=auth.uid() and deleted_at is null and title ilike '%'||search_text||'%'
   union all select 'notes',id,title,revision,left(content_json::text,300) from public.note_pages where user_id=auth.uid() and status<>'trash' and (title ilike '%'||search_text||'%' or content_json::text ilike '%'||search_text||'%')
   union all select 'applications',id,company||' · '||role,revision,left(company||' '||role,300) from public.job_roles where user_id=auth.uid() and deleted_at is null and (company||' '||role) ilike '%'||search_text||'%'
   union all select 'knowledge',id::text,title,revision,left(coalesce(summary,content_md,''),300) from public.kb_entries where user_id=auth.uid() and (coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(content_md,'')) ilike '%'||search_text||'%'
  ) matches where (not p_input?'module' or module=p_input->>'module') and module||':'||id>cursor_value order by module,id limit row_limit) r;
 else
  source_table:=case p_query when 'list_files' then 'file_objects' when 'list_resumes' then 'resumes' when 'query_tasks' then 'tasks' when 'list_contexts' then 'contexts' when 'query_scratch_blocks' then 'scratch_blocks' when 'list_task_views' then 'saved_task_views' when 'query_notes' then 'note_pages' when 'read_note' then 'note_pages' when 'list_note_folders' then 'note_folders' when 'query_note_suggestions' then 'note_suggestions' when 'query_applications' then 'job_roles' when 'query_job_catalog' then 'job_listings' when 'query_knowledge' then 'kb_entries' when 'query_attempts' then 'leetcode_attempts' when 'query_mistakes' then 'leetcode_notes' when 'query_problems' then 'leetcode_problems' when 'query_weekly_reviews' then 'weekly_reviews' else null end;
  if source_table is null then raise exception 'Unsupported Manor query: %',p_query; end if;
  execute format($query$
   select coalesce(jsonb_agg(case when $1='query_notes' then record-'content_json' else record end order by record->>'id'),'[]') from (
    select to_jsonb(t)-'user_id' record from public.%I t
    where ($2='' or to_jsonb(t)->>'id'>$2)
    and (not $3?'id' or to_jsonb(t)->>'id'=$3->>'id')
    and ($1<>'list_files' or to_jsonb(t)->>'status'='ready')
    and (not $3?'purpose' or to_jsonb(t)->>'purpose'=$3->>'purpose')
    and (not $3?'parent_id' or to_jsonb(t)->>'parent_id'=$3->>'parent_id')
    and (not $3?'note_id' or to_jsonb(t)->>'note_id'=$3->>'note_id')
    and (not $3?'folder_id' or to_jsonb(t)->>'folder_id'=$3->>'folder_id')
    and (not $3?'context_id' or to_jsonb(t)->>'context_id'=$3->>'context_id')
    and (not $3?'status' or to_jsonb(t)->>'status'=$3->>'status')
    and (not $3?'stage' or to_jsonb(t)->>'stage'=$3->>'stage')
    and (not $3?'problem_id' or to_jsonb(t)->>'problem_id'=$3->>'problem_id')
    and (not $3?'from' or coalesce(to_jsonb(t)->>'due',to_jsonb(t)->>'date',to_jsonb(t)->>'period_start',to_jsonb(t)->>'created_at')>=$3->>'from')
    and (not $3?'to' or coalesce(to_jsonb(t)->>'due',to_jsonb(t)->>'date',to_jsonb(t)->>'period_start',to_jsonb(t)->>'created_at')<=$3->>'to')
    and ($4='' or concat_ws(' ',to_jsonb(t)->>'title',to_jsonb(t)->>'name',to_jsonb(t)->>'company',to_jsonb(t)->>'role',to_jsonb(t)->>'text') ilike '%%'||$4||'%%')
    and ($6<>'tasks' or $5='all' or (to_jsonb(t)->>'skipped_at' is null and to_jsonb(t)->>'superseded_at' is null))
    and ($5='all' or case when $6='note_pages' then case when $5='trash' then to_jsonb(t)->>'status'='trash' when $5='archived' then to_jsonb(t)->>'status'='archived' else to_jsonb(t)->>'status'='active' end when $6 in ('tasks','job_roles') then case when $5='trash' then to_jsonb(t)->>'deleted_at' is not null else to_jsonb(t)->>'deleted_at' is null end else true end)
    order by to_jsonb(t)->>'id' limit $7
   ) bounded
  $query$,source_table) into rows_json using p_query,cursor_value,p_input,search_text,life,source_table,row_limit;
 end if;
 return jsonb_build_object('items',coalesce(rows_json,'[]'),'next_cursor',case when jsonb_array_length(coalesce(rows_json,'[]'))=row_limit then case when p_query='query_daily_records' then rows_json->-1->>'date' when p_query='list_note_versions' then rows_json->-1->>'revision' when p_query='search' then (rows_json->-1->>'module')||':'||(rows_json->-1->>'id') else rows_json->-1->>'id' end end);
end $$;
revoke all on function public.manor_query(text,jsonb) from public,anon;
grant execute on function public.manor_query(text,jsonb) to authenticated;
grant execute on function manor_private.find_block(jsonb,text) to authenticated;
