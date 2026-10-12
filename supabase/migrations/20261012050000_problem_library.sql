-- General account-owned problem catalog. Existing problems, attempts, and notes retain identity.
begin;
grant create on schema manor_private,public to manor_commands;

alter table public.leetcode_problems
 alter column difficulty drop not null,
 add column revision bigint not null default 1,
 add column kind text not null default 'coding' check(kind in ('coding','system_design','behavioral','other')),
 add column topics text[] not null default '{}',
 add column companies text[] not null default '{}',
 add column tags text[] not null default '{}',
 add column collections text[] not null default '{}',
 add column source_url text check(source_url is null or (length(source_url)<=2000 and source_url ~ '^https?://')),
 add column source_type text not null default 'stock' check(source_type in ('stock','imported','custom')),
 add column external_key text check(external_key is null or length(external_key) between 1 and 200),
 add column content_available boolean not null default false,
 add column content_version integer not null default 0 check(content_version>=0),
 add constraint problem_content_availability check(content_available=(content_version>0));
update public.leetcode_problems set topics=array[topic],collections=array['NeetCode 150'];
create unique index problem_catalog_external_key on public.leetcode_problems(user_id,source_type,external_key) where external_key is not null;
create index problem_catalog_kind on public.leetcode_problems(user_id,kind,name,id);
create index problem_catalog_topics on public.leetcode_problems using gin(topics);
create index problem_catalog_companies on public.leetcode_problems using gin(companies);
create index problem_catalog_tags on public.leetcode_problems using gin(tags);
create index problem_catalog_collections on public.leetcode_problems using gin(collections);

create table public.problem_content_versions (
 user_id uuid not null references auth.users(id) on delete cascade,
 problem_id text not null, version integer not null check(version>0),
 statement_markdown text not null check(length(statement_markdown) between 1 and 1000000),
 examples jsonb not null check(jsonb_typeof(examples)='array' and jsonb_array_length(examples)<=100),
 hints text[] not null, solution_markdown text check(solution_markdown is null or length(solution_markdown)<=1000000),
 starter_code jsonb not null check(jsonb_typeof(starter_code)='object'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,problem_id,version),
 foreign key(user_id,problem_id) references public.leetcode_problems(user_id,id) on delete cascade
);
create table public.saved_problem_views (
 id text not null check(length(id) between 1 and 200),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 120),
 filters jsonb not null check(jsonb_typeof(filters)='object'),
 sort jsonb not null check(jsonb_typeof(sort)='array' and jsonb_array_length(sort) between 1 and 5),
 group_by text check(group_by in ('topic','company','difficulty','kind','collection')),
 visible_columns text[] not null check(cardinality(visible_columns) between 1 and 7),
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,id)
);

create table public.problem_code_drafts (
 id text not null check(length(id) between 1 and 200), user_id uuid not null references auth.users(id) on delete cascade,
 problem_id text not null, language text not null check(language in ('cpp','c','python','javascript','java','go')),
 content_version integer not null check(content_version>0), source text not null check(length(source)<=100000),
 revision bigint not null default 1, updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,id), unique(user_id,problem_id,language),
 foreign key(user_id,problem_id,content_version) references public.problem_content_versions(user_id,problem_id,version) on delete cascade
);
do $$ declare t text; begin
 foreach t in array array['problem_content_versions','saved_problem_views','problem_code_drafts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to manor_commands',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy problem_read_owner on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
  execute format('create policy problem_command_owner on public.%I to manor_commands using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
 end loop;
end $$;
create or replace function manor_private.seed_curriculum() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order,topics,collections)
 select new.id,id,topic,name,difficulty,curriculum_order,array[topic],array['NeetCode 150'] from manor_private.leetcode_curriculum;
 return new;
end $$;

create trigger manor_history after insert or update or delete on public.leetcode_problems for each row when (nullif(current_setting('manor.command_id',true),'') is not null) execute function manor_private.record_change();
create trigger manor_workspace_changes after insert or update or delete on public.leetcode_problems for each row execute function manor_private.record_workspace_change();
create trigger manor_history after insert or update or delete on public.saved_problem_views for each row execute function manor_private.record_change();
create trigger manor_workspace_changes after insert or update or delete on public.saved_problem_views for each row execute function manor_private.record_workspace_change();

create trigger manor_workspace_changes after insert or update or delete on public.problem_code_drafts for each row execute function manor_private.record_workspace_change();

-- All labels are bounded and deduplicated before reaching the catalog or a saved view.
create function manor_private.problem_labels(p jsonb,p_limit integer,p_length integer) returns text[] language plpgsql immutable set search_path='' as $$
declare values_out text[]; item jsonb;
begin
 if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)>p_limit then raise exception using errcode='22023',message='Problem labels must be a bounded array'; end if;
 for item in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and p_length then raise exception using errcode='22023',message='Problem labels must contain nonempty bounded strings'; end if;
 end loop;
 select coalesce(array_agg(value order by ord),'{}') into values_out from jsonb_array_elements_text(p) with ordinality as labels(value,ord);
 if cardinality(values_out)<>(select count(distinct btrim(value)) from unnest(values_out) value) then raise exception using errcode='22023',message='Problem labels must be unique'; end if;
 return array(select btrim(value) from unnest(values_out) value);
end $$;
revoke all on function manor_private.problem_labels(jsonb,integer,integer) from public;
grant execute on function manor_private.problem_labels(jsonb,integer,integer) to manor_commands;

create function manor_private.validate_problem_content(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare example jsonb; language text; code jsonb; hint text;
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'statement_markdown') is distinct from 'string' or length(p->>'statement_markdown') not between 1 and 1000000 then raise exception 'Problem content requires a statement from 1 to 1000000 characters'; end if;
 if jsonb_typeof(p->'examples') is distinct from 'array' or jsonb_array_length(p->'examples')>100 then raise exception 'Problem examples must be an array of at most 100 examples'; end if;
 for example in select value from jsonb_array_elements(p->'examples') loop
  if jsonb_typeof(example) is distinct from 'object' or jsonb_typeof(example->'input') is distinct from 'string' or jsonb_typeof(example->'output') is distinct from 'string' or not(example?'explanation') or (example->'explanation'<>'null'::jsonb and jsonb_typeof(example->'explanation') is distinct from 'string') or length(example->>'input')>100000 or length(example->>'output')>100000 or length(example->>'explanation')>100000 then raise exception 'Each example requires bounded input, output, and nullable explanation strings'; end if;
 end loop;
 if jsonb_typeof(p->'hints') is distinct from 'array' or jsonb_array_length(p->'hints')>100 then raise exception 'Problem hints must be an array of at most 100 hints'; end if;
 for hint in select jsonb_array_elements_text(p->'hints') loop
  if length(hint) not between 1 and 100000 then raise exception 'Problem hints must contain 1 to 100000 characters'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'hints') value where jsonb_typeof(value)<>'string') then raise exception 'Problem hints must be strings'; end if;
 if not(p?'solution_markdown') or (p->'solution_markdown'<>'null'::jsonb and jsonb_typeof(p->'solution_markdown') is distinct from 'string') or length(p->>'solution_markdown')>1000000 then raise exception 'Problem solution must be null or a bounded Markdown string'; end if;
 if jsonb_typeof(p->'starter_code') is distinct from 'object' then raise exception 'Problem starter code must be an object keyed by language'; end if;
 for language,code in select * from jsonb_each(p->'starter_code') loop
  if language not in ('cpp','c','python','javascript','java','go') or jsonb_typeof(code)<>'string' or length(code#>>'{}')>100000 then raise exception 'Starter code requires a supported language and at most 100000 characters'; end if;
 end loop;
end $$;
revoke all on function manor_private.validate_problem_content(jsonb) from public;
grant execute on function manor_private.validate_problem_content(jsonb) to manor_commands;

create function manor_private.save_problem(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare existing public.leetcode_problems; previous public.problem_content_versions; rid text:=p->>'id'; content jsonb:=p->'content'; next_version integer; result jsonb;
 topics_value text[]; companies_value text[]; tags_value text[]; collections_value text[]; matched_id text; testset_result jsonb;
begin
 if length(rid) not between 1 and 200 or rid is null then raise exception 'A problem requires a stable ID from 1 to 200 characters'; end if;
 if p->>'external_key' is not null then
  select id into matched_id from public.leetcode_problems where user_id=auth.uid() and source_type=p->>'source_type' and external_key=p->>'external_key' for update;
  if matched_id is not null then rid:=matched_id; end if;
 end if;
 select * into existing from public.leetcode_problems where user_id=auth.uid() and id=rid for update;
 if length(btrim(p->>'name')) not between 1 and 500 or jsonb_typeof(p->'name') is distinct from 'string' then raise exception 'A problem name requires 1 to 500 characters'; end if;
 if p->>'kind' is null or p->>'kind' not in ('coding','system_design','behavioral','other') then raise exception 'Choose a supported problem kind'; end if;
 if not(p?'difficulty') or (p->>'difficulty' is not null and p->>'difficulty' not in ('Easy','Medium','Hard')) then raise exception 'Difficulty must be Easy, Medium, Hard, or null'; end if;
 if p->>'source_type' is null or p->>'source_type' not in ('stock','imported','custom') then raise exception 'Choose a supported problem source type'; end if;
 if not(p?'source_url') or (p->>'source_url' is not null and (length(p->>'source_url')>2000 or p->>'source_url' !~ '^https?://')) then raise exception 'Source URL must be null or a bounded HTTP URL'; end if;
 if not(p?'external_key') or (p->>'external_key' is not null and length(p->>'external_key') not between 1 and 200) then raise exception 'External key must be null or a bounded stable identifier'; end if;
 topics_value:=manor_private.problem_labels(p->'topics',100,100);
 companies_value:=manor_private.problem_labels(p->'companies',100,100);
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
  existing.name=btrim(p->>'name') and existing.difficulty is not distinct from p->>'difficulty' and existing.kind=p->>'kind' and existing.topics=topics_value and existing.companies=companies_value and existing.tags=tags_value and existing.collections=collections_value and existing.source_url is not distinct from p->>'source_url' and
  (content='null'::jsonb or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code)=content) and not(p?'testset') then
  return to_jsonb(existing)||jsonb_build_object('import_outcome','unchanged');
 end if;
 perform manor_private.require_revision(existing.revision,(p->>'expected_revision')::bigint,to_jsonb(existing));
 if content<>'null'::jsonb and (previous.version is null or jsonb_build_object('statement_markdown',previous.statement_markdown,'examples',previous.examples,'hints',previous.hints,'solution_markdown',previous.solution_markdown,'starter_code',previous.starter_code) is distinct from content) then next_version:=next_version+1; end if;
 insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order,kind,topics,companies,tags,collections,source_url,source_type,external_key,content_available,content_version)
 values(auth.uid(),rid,coalesce(topics_value[1],'General'),btrim(p->>'name'),p->>'difficulty',coalesce(existing.curriculum_order,0),p->>'kind',topics_value,companies_value,tags_value,collections_value,p->>'source_url',p->>'source_type',p->>'external_key',next_version>0,next_version)
 on conflict(user_id,id) do update set topic=excluded.topic,name=excluded.name,difficulty=excluded.difficulty,kind=excluded.kind,topics=excluded.topics,companies=excluded.companies,tags=excluded.tags,collections=excluded.collections,source_url=excluded.source_url,source_type=excluded.source_type,external_key=excluded.external_key,content_available=excluded.content_available,content_version=excluded.content_version,revision=public.leetcode_problems.revision+1,updated_at=clock_timestamp()
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

create function manor_private.problem_library_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; result jsonb; outcomes jsonb:='[]'; draft public.problem_code_drafts; current_version integer; view_row public.saved_problem_views; filters jsonb; sort_item jsonb; columns_value text[]; key text;
begin
 if op='save_problem_draft' then
  if p->>'language' is null or p->>'language' not in ('cpp','c','python','javascript','java','go') or jsonb_typeof(p->'source') is distinct from 'string' or length(p->>'source')>100000 then raise exception 'Code draft requires a supported language and source of at most 100000 characters'; end if;
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
alter function manor_private.problem_library_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.problem_library_command(text,jsonb) from public;

create function public.manor_problem_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  select to_jsonb(p)-'user_id'||jsonb_build_object('status',case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else 'unattempted' end) into problem from public.leetcode_problems p where user_id=auth.uid() and id=p_input->>'id';
  if problem is null then raise exception using errcode='P0002',message='Problem does not exist or is not owned by this account'; end if;
  select to_jsonb(c)-'user_id' into content from public.problem_content_versions c where user_id=auth.uid() and problem_id=p_input->>'id' and version=(problem->>'content_version')::integer;
  return jsonb_build_object('problem',problem,'content',content);
 elsif p_query='list_problem_views' then
  select coalesce(jsonb_agg(to_jsonb(v)-'user_id' order by id),'[]') into items from (select * from public.saved_problem_views where user_id=auth.uid() and id>after_id order by id limit take) v;
 elsif p_query='query_problems' then
  select coalesce(jsonb_agg(to_jsonb(p)-'user_id' order by id),'[]') into items from (
   select p.*,case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=p.id) then 'solved' else 'unattempted' end as status
   from public.leetcode_problems p where user_id=auth.uid() and id>after_id
   and (p_input->>'search' is null or name ilike '%'||(p_input->>'search')||'%')
   and (p_input->>'kind' is null or kind=p_input->>'kind')
   and (p_input->>'difficulty' is null or difficulty=p_input->>'difficulty')
   and (p_input->>'source_type' is null or source_type=p_input->>'source_type')
   and (p_input->>'topic' is null or p_input->>'topic'=any(topics))
   and (p_input->>'company' is null or p_input->>'company'=any(companies))
   and (p_input->>'tag' is null or p_input->>'tag'=any(tags))
   and (p_input->>'collection' is null or p_input->>'collection'=any(collections))
   and (not(p_input?'has_content') or content_available=(p_input->>'has_content')::boolean)
   order by id limit take) p;
  select count(*) into total from public.leetcode_problems where user_id=auth.uid();
 else raise exception 'Unsupported problem query: %',p_query;
 end if;
 return jsonb_build_object('items',items,'total',total,'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'id' end);
end $$;
alter function public.manor_problem_query(text,jsonb) owner to manor_commands;
revoke all on function public.manor_problem_query(text,jsonb) from public,anon;
grant execute on function public.manor_problem_query(text,jsonb) to authenticated;

-- Remove the retired practice streak interface without deleting its historical data.
revoke execute on function public.manor_leetcode_summary() from authenticated,anon,public;

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
