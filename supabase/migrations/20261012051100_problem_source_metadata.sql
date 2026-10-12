-- Source recency retains its original precision and distinguishes dataset snapshots from reports.
begin;
grant create on schema manor_private,public to manor_commands;
create or replace function manor_private.problem_source_date(p jsonb,p_end boolean) returns date language plpgsql immutable set search_path='' as $$
declare value text:=p->>'value'; precision_value text:=p->>'precision'; result date;
begin
 if p is null or p='null'::jsonb then return null; end if;
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'value') is distinct from 'string' or precision_value is null then raise exception 'Source dates require value and precision'; end if;
 if precision_value='day' and value ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then result:=value::date;
 elsif precision_value='month' and value ~ '^[1-9][0-9]{3}-[0-9]{2}$' then result:=(value||'-01')::date; if p_end then result:=(result+interval '1 month -1 day')::date; end if;
 elsif precision_value='year' and value ~ '^[1-9][0-9]{3}$' then result:=(value||case when p_end then '-12-31' else '-01-01' end)::date;
 elsif precision_value='instant' and value ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' and length(value)<=40 then result:=(value::timestamptz at time zone 'UTC')::date;
 else raise exception 'Source date precision and value disagree'; end if;
 return result;
end $$;
create or replace function manor_private.validate_problem_source_metadata(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare key text; item jsonb; day_value date;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>1048576 then raise exception 'Source metadata requires an object at most 1 MiB'; end if;
 foreach key in array array['lastAsked','reportedFrom','reportedTo'] loop
  if p?key then
   if jsonb_typeof(p->key) is distinct from 'object' then raise exception 'Source date fields require value and precision objects'; end if;
   perform manor_private.problem_source_date(p->key,false);
  end if;
 end loop;
 if p?'reportedFrom' and p?'reportedTo' and manor_private.problem_source_date(p->'reportedFrom',false)>manor_private.problem_source_date(p->'reportedTo',true) then raise exception 'Source reporting range is reversed'; end if;
 foreach key in array array['frequency','status'] loop
  if p?key and (jsonb_typeof(p->key) is distinct from 'string' or length(btrim(p->>key)) not between 1 and 100) then raise exception 'Source frequency/status require bounded nonempty strings'; end if;
 end loop;
 foreach key in array array['reportCount','durationMinutes'] loop
  if p?key and (jsonb_typeof(p->key) is distinct from 'number' or p->>key !~ '^[0-9]+$' or (p->>key)::numeric>case when key='durationMinutes' then 1000000 else 2147483647 end) then raise exception 'Source counts and duration require bounded nonnegative integers'; end if;
 end loop;
 if p?'isNew' and jsonb_typeof(p->'isNew') is distinct from 'boolean' then raise exception 'Source isNew requires a boolean'; end if;
 if p?'snapshots' then
  if jsonb_typeof(p->'snapshots') is distinct from 'array' or jsonb_array_length(p->'snapshots')>100 then raise exception 'Source snapshots require an array with at most 100 records'; end if;
  for item in select value from jsonb_array_elements(p->'snapshots') loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'sourceUrl') is distinct from 'string' or item->>'sourceUrl' !~ '^https?://' or length(item->>'sourceUrl')>2000 or jsonb_typeof(item->'snapshotDate') is distinct from 'string' or item->>'snapshotDate' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'Source snapshot requires HTTP URL and exact date'; end if;
   day_value:=(item->>'snapshotDate')::date;
   if item?'revision' and (jsonb_typeof(item->'revision') is distinct from 'string' or length(item->>'revision') not between 1 and 200) then raise exception 'Source snapshot revision must be bounded'; end if;
  end loop;
 end if;
 if p?'companyReports' then
  if jsonb_typeof(p->'companyReports') is distinct from 'array' or jsonb_array_length(p->'companyReports')>5000 then raise exception 'Company reports require an array with at most 5000 records'; end if;
  for item in select value from jsonb_array_elements(p->'companyReports') loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'company') is distinct from 'string' or length(btrim(item->>'company')) not between 1 and 100 or item->>'window' is null or item->>'window' not in ('30d','3m','6m','1y','all','older_than_6m') then raise exception 'Company report requires company and a supported reporting window'; end if;
   foreach key in array array['frequency','acceptance'] loop
    if not(item?key) or (jsonb_typeof(item->key)<>'null' and (jsonb_typeof(item->key) is distinct from 'number' or (item->>key)::numeric not between 0 and 100)) then raise exception 'Company percentages must be null or numbers from 0 to 100'; end if;
   end loop;
   if jsonb_typeof(item->'snapshotDate') is distinct from 'string' or item->>'snapshotDate' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(item->'sourceUrl') is distinct from 'string' or item->>'sourceUrl' !~ '^https?://' or length(item->>'sourceUrl')>2000 or jsonb_typeof(item->'sourceRevision') is distinct from 'string' or length(item->>'sourceRevision') not between 1 and 200 then raise exception 'Company report requires snapshot date, HTTP URL, and revision'; end if;
   day_value:=(item->>'snapshotDate')::date;
  end loop;
 end if;
 return true;
end $$;
alter function manor_private.problem_source_date(jsonb,boolean) owner to manor_commands;
alter function manor_private.validate_problem_source_metadata(jsonb) owner to manor_commands;
revoke all on function manor_private.problem_source_date(jsonb,boolean),manor_private.validate_problem_source_metadata(jsonb) from public;
alter table public.leetcode_problems add column source_metadata jsonb not null default '{}'::jsonb;
alter table public.leetcode_problems add constraint problem_source_metadata_valid check(manor_private.validate_problem_source_metadata(source_metadata));
grant select(source_metadata),insert(source_metadata),update(source_metadata) on public.leetcode_problems to manor_commands;
create or replace function manor_private.save_problem(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare existing public.leetcode_problems; previous public.problem_content_versions; rid text:=p->>'id'; content jsonb:=p->'content'; next_version integer; result jsonb;
 topics_value text[]; companies_value text[]; tags_value text[]; collections_value text[]; matched_id text; testset_result jsonb; source_metadata_value jsonb;
begin
 if length(rid) not between 1 and 200 or rid is null then raise exception 'A problem requires a stable ID from 1 to 200 characters'; end if;
 if p->>'external_key' is not null then
  select id into matched_id from public.leetcode_problems where user_id=auth.uid() and source_type=p->>'source_type' and external_key=p->>'external_key' for update;
  if matched_id is not null then rid:=matched_id; end if;
 end if;
 select * into existing from public.leetcode_problems where user_id=auth.uid() and id=rid for update;
 source_metadata_value:=coalesce(p->'source_metadata',existing.source_metadata,'{}'::jsonb);
 perform manor_private.validate_problem_source_metadata(source_metadata_value);
 if length(btrim(p->>'name')) not between 1 and 500 or jsonb_typeof(p->'name') is distinct from 'string' then raise exception 'A problem name requires 1 to 500 characters'; end if;
 if p->>'kind' is null or p->>'kind' not in ('coding','system_design','behavioral','other') then raise exception 'Choose a supported problem kind'; end if;
 if not(p?'difficulty') or (p->>'difficulty' is not null and p->>'difficulty' not in ('Easy','Medium','Hard')) then raise exception 'Difficulty must be Easy, Medium, Hard, or null'; end if;
 if p->>'source_type' is null or p->>'source_type' not in ('stock','imported','custom') then raise exception 'Choose a supported problem source type'; end if;
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
  select * into previous from public.problem_content_versions where user_id=auth.uid() and problem_id=rid and version=next_version;
 end if;
 -- Imports retried with a new command ID may identify an unchanged source again without overwriting edits.
 if existing.id is not null and (p->>'expected_revision')::bigint=0 and matched_id is not null and
  existing.source_metadata=source_metadata_value and existing.name=btrim(p->>'name') and existing.difficulty is not distinct from p->>'difficulty' and existing.kind=p->>'kind' and existing.topics=topics_value and existing.companies=companies_value and existing.tags=tags_value and existing.collections=collections_value and existing.source_url is not distinct from p->>'source_url' and
  (content='null'::jsonb or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code)=content) and not(p?'testset') then
  return to_jsonb(existing)||jsonb_build_object('import_outcome','unchanged');
 end if;
 perform manor_private.require_revision(existing.revision,(p->>'expected_revision')::bigint,to_jsonb(existing));
 if content<>'null'::jsonb and (previous.version is null or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code) is distinct from content) then next_version:=next_version+1; end if;
 insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order,kind,topics,companies,tags,collections,source_url,source_type,external_key,content_available,content_version,source_metadata)
 values(auth.uid(),rid,coalesce(topics_value[1],'General'),btrim(p->>'name'),p->>'difficulty',coalesce(existing.curriculum_order,0),p->>'kind',topics_value,companies_value,tags_value,collections_value,p->>'source_url',p->>'source_type',p->>'external_key',next_version>0,next_version,source_metadata_value)
 on conflict(user_id,id) do update set topic=case when public.leetcode_problems.source_type='stock' then public.leetcode_problems.topic else excluded.topic end,name=excluded.name,difficulty=excluded.difficulty,kind=excluded.kind,topics=excluded.topics,companies=excluded.companies,tags=excluded.tags,collections=excluded.collections,source_url=excluded.source_url,source_type=excluded.source_type,external_key=excluded.external_key,content_available=excluded.content_available,content_version=excluded.content_version,source_metadata=excluded.source_metadata,revision=public.leetcode_problems.revision+1,updated_at=clock_timestamp()
 returning to_jsonb(leetcode_problems.*) into result;
 if content<>'null'::jsonb and next_version>coalesce(previous.version,0) then
  insert into public.problem_content_versions(user_id,problem_id,version,statement_markdown,examples,hints,solution_markdown,starter_code)
  values(auth.uid(),rid,next_version,content->>'statement_markdown',content->'examples',array(select jsonb_array_elements_text(content->'hints')),content->>'solution_markdown',content->'starter_code');
 end if;
 if p?'testset' then
  if p->>'kind'<>'coding' or next_version=0 then raise exception 'A testset requires a coding problem with a saved statement'; end if;
  execute 'select manor_private.save_problem_testset($1)' into testset_result using p->'testset'||jsonb_build_object('userId',auth.uid(),'problemId',rid,'contentVersion',next_version);
  result:=result||jsonb_build_object('testset',testset_result);
 end if;
 return result||jsonb_build_object('import_outcome',case when existing.id is null then 'created' else 'updated' end);
end $$;
alter function manor_private.save_problem(jsonb) owner to manor_commands;
revoke all on function manor_private.save_problem(jsonb) from public;

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
  foreach key in array array['lastAskedSince','lastAskedUntil'] loop
   if filters->>key is not null then perform manor_private.problem_source_date(jsonb_build_object('value',filters->>key,'precision','day'),false); end if;
  end loop;
  if filters->>'lastAskedSince'>filters->>'lastAskedUntil' then raise exception 'Saved recency date range is reversed'; end if;
  if jsonb_typeof(p->'sort') is distinct from 'array' or jsonb_array_length(p->'sort') not between 1 and 5 then raise exception 'Saved view requires 1 to 5 sort rules'; end if;
  for sort_item in select value from jsonb_array_elements(p->'sort') loop
   if sort_item->>'field' is null or sort_item->>'field' not in ('name','difficulty','kind','createdAt','updatedAt','lastAsked') or sort_item->>'direction' is null or sort_item->>'direction' not in ('asc','desc') then raise exception 'Saved view sort rule is invalid'; end if;
  end loop;
  columns_value:=manor_private.problem_labels(p->'visible_columns',8,100);
  if cardinality(columns_value)=0 or exists(select 1 from unnest(columns_value) value where value not in ('difficulty','kind','topics','companies','tags','collections','status','lastAsked')) then raise exception 'Saved view columns are invalid'; end if;
  if not(p?'group_by') or (p->>'group_by' is not null and p->>'group_by' not in ('topic','company','difficulty','kind','collection')) then raise exception 'Saved view grouping is invalid'; end if;
  insert into public.saved_problem_views(user_id,id,name,filters,sort,group_by,visible_columns)
  values(auth.uid(),p->>'id',btrim(p->>'name'),filters,p->'sort',p->>'group_by',columns_value)
  on conflict(user_id,id) do update set name=excluded.name,filters=excluded.filters,sort=excluded.sort,group_by=excluded.group_by,visible_columns=excluded.visible_columns,revision=public.saved_problem_views.revision+1,updated_at=clock_timestamp()
  returning to_jsonb(saved_problem_views.*) into result;
  return result;
 end if;
 raise exception 'Unsupported problem library operation: %',op;
end $$;


alter function manor_private.problem_library_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.problem_library_command(text,jsonb) from public;
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
  can_grade:=problem->>'kind'='coding' and problem->>'source_type' in ('imported','custom') and exists(select 1 from manor_private.problem_testsets t where t.user_id=auth.uid() and t.problem_id=p_input->>'id' and t.content_version=(problem->>'content_version')::integer);
  return jsonb_build_object('problem',problem,'content',content,'can_execute',can_grade or (problem->>'kind'='coding' and problem->>'source_type'='custom' and content is not null),'grading_available',can_grade);
 elsif p_query='list_problem_views' then
  select coalesce(jsonb_agg(to_jsonb(v)-'user_id' order by id),'[]') into items from (select * from public.saved_problem_views where user_id=auth.uid() and id>after_id order by id limit take) v;
 elsif p_query='query_problems' then
  if p_input->>'status' is not null and p_input->>'status' not in ('unattempted','attempted','solved') then raise exception 'Problem status filter is invalid'; end if;
  if p_input->>'last_asked_since' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_since','precision','day'),false); end if;
  if p_input->>'last_asked_until' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_until','precision','day'),false); end if;
  if p_input->>'last_asked_since'>p_input->>'last_asked_until' then raise exception 'Recency date range is reversed'; end if;
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
   and (p_input->>'last_asked_since' is null or manor_private.problem_source_date(source_metadata->'lastAsked',true)>=(p_input->>'last_asked_since')::date)
   and (p_input->>'last_asked_until' is null or manor_private.problem_source_date(source_metadata->'lastAsked',false)<=(p_input->>'last_asked_until')::date)
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



revoke create on schema manor_private,public from manor_commands;
commit;
