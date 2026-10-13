-- Manor's shared problem catalog. Stock and imported problems become one catalog without an owner (`user_id` null)
-- that every approved account reads; custom problems stay private to the account that owns them. Practice state
-- moves to `problem_practice`, content versions and testsets key by problem alone, and the catalog gets its own
-- change feed, snapshot bucket, and operator command. Schema, data conversion, and every function that reads the
-- old shape change in this one transaction, so no function body ever runs against the other shape.
begin;
set local lock_timeout='5s';
grant create on schema manor_private,public to manor_commands;

-- Take every lock up front, in one order, so concurrent execution traffic waits instead of deadlocking.
lock table public.leetcode_problems,public.problem_content_versions,manor_private.problem_testsets,public.problem_submissions,
 public.problem_code_drafts,public.leetcode_attempts,manor_private.problem_editor_sessions in access exclusive mode;

-- The catalog source is the account holding the most stock and imported problems with statements. Every other
-- account's stock and imported rows must be copies of its problems without statements of their own.
create temporary table catalog_source on commit drop as
select user_id from public.leetcode_problems where source_type<>'custom'
group by user_id order by count(*) filter (where content_version>0) desc,count(*) desc,user_id limit 1;
create temporary table catalog_counts on commit drop as
select u.id user_id,
 (select count(*) from public.leetcode_attempts a where a.user_id=u.id) attempts,
 (select count(*) from public.leetcode_notes n where n.user_id=u.id) notes,
 (select count(*) from public.problem_submissions s where s.user_id=u.id) submissions,
 (select count(*) from public.problem_code_drafts d where d.user_id=u.id) drafts,
 (select count(*) from public.saved_problem_views v where v.user_id=u.id) views,
 (select count(*) from public.leetcode_problems p where p.user_id=u.id and p.practice_status<>'unattempted') practice
from auth.users u;
create temporary table catalog_totals on commit drop as
select (select count(*) from public.problem_content_versions) contents,(select count(*) from manor_private.problem_testsets) testsets;
create temporary table catalog_curriculum on commit drop as
select c.id,coalesce(p.curriculum_order,c.curriculum_order) curriculum_order from manor_private.leetcode_curriculum c
left join public.leetcode_problems p on p.user_id=(select user_id from catalog_source) and p.id=c.id;
create temporary table catalog_practice on commit drop as
select user_id,id problem_id,practice_status status,updated_at from public.leetcode_problems where practice_status<>'unattempted';

do $$
declare source uuid:=(select user_id from catalog_source); problem text;
begin
 select p.id into problem from public.leetcode_problems p where p.source_type<>'custom' and p.user_id<>source
 and not exists(select 1 from public.leetcode_problems s where s.user_id=source and s.id=p.id and s.source_type<>'custom') order by p.id limit 1;
 if problem is not null then raise exception 'Catalog conversion stopped: problem % exists outside the catalog source account %',problem,source; end if;
 select c.problem_id into problem from public.problem_content_versions c join public.leetcode_problems p on p.user_id=c.user_id and p.id=c.problem_id
 where p.source_type<>'custom' and p.user_id<>source order by 1 limit 1;
 if problem is not null then raise exception 'Catalog conversion stopped: account copy of problem % has its own statement',problem; end if;
 select id into problem from public.leetcode_problems where source_type='custom' or user_id=source group by id having count(*)>1 order by id limit 1;
 if problem is not null then raise exception 'Catalog conversion stopped: problem ID % is used by more than one problem',problem; end if;
end $$;

alter table public.leetcode_attempts drop constraint leetcode_attempts_user_id_problem_id_fkey;
alter table public.problem_code_drafts drop constraint problem_code_drafts_user_id_problem_id_content_version_fkey;
alter table public.problem_submissions drop constraint problem_submissions_user_id_problem_id_content_version_fkey;
alter table manor_private.problem_editor_sessions drop constraint problem_editor_sessions_user_id_problem_id_fkey;
alter table manor_private.problem_testsets drop constraint problem_testsets_user_id_problem_id_content_version_fkey;
alter table public.problem_content_versions drop constraint problem_content_versions_user_id_problem_id_fkey;
alter table public.leetcode_problems drop constraint problem_canonical_owner,
 disable trigger manor_workspace_changes,disable trigger manor_history,disable trigger problem_canonical_guard;

-- Other accounts' copies carry no statements; their attempts and notes keep the same problem IDs.
delete from public.leetcode_problems where source_type<>'custom' and user_id<>(select user_id from catalog_source);

alter table public.problem_content_versions drop constraint problem_content_versions_pkey;
alter table public.problem_content_versions alter column user_id drop not null;
update public.problem_content_versions c set user_id=null from public.leetcode_problems p where p.user_id=c.user_id and p.id=c.problem_id and p.source_type<>'custom';
alter table public.problem_content_versions add primary key(problem_id,version);

alter table manor_private.problem_testsets drop constraint problem_testsets_pkey;
alter table manor_private.problem_testsets drop column user_id;
alter table manor_private.problem_testsets add primary key(problem_id,version);

-- Owner-keyed indexes go first so the owner flip below is a heap-only update that leaves the label indexes alone.
alter table public.leetcode_problems drop constraint leetcode_problems_pkey,drop constraint problem_alias_imported;
drop index public.problem_catalog_external_key,public.problem_catalog_kind,public.problem_catalog_canonical;
alter table public.leetcode_problems alter column user_id drop not null,drop column practice_status,
 add column grading_version integer check(grading_version>0);
update public.leetcode_problems p set user_id=case when p.source_type='custom' then p.user_id end,
 grading_version=(select max(t.version) from manor_private.problem_testsets t where t.problem_id=p.id and t.content_version=p.content_version);
alter table public.leetcode_problems add primary key(id),
 add constraint problem_catalog_owner check((user_id is null)=(source_type<>'custom')),
 add constraint problem_alias_imported check(canonical_problem_id is null or source_type in ('imported','custom')),
 add constraint problem_canonical_owner foreign key(canonical_problem_id) references public.leetcode_problems(id);
create index problem_catalog_kind on public.leetcode_problems(kind,name,id);
create unique index problem_catalog_external_key on public.leetcode_problems(source_type,external_key) where user_id is null and external_key is not null;
create unique index problem_account_external_key on public.leetcode_problems(user_id,source_type,external_key) where user_id is not null and external_key is not null;
create index problem_catalog_canonical on public.leetcode_problems(canonical_problem_id,id);
create index problem_account_owner on public.leetcode_problems(user_id) where user_id is not null;

-- Curriculum positions live on the catalog rows; a database without them (a replay from empty) gets them here.
insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order,topics,collections,source_url)
select null,c.id,c.topic,c.name,c.difficulty,c.curriculum_order,array[c.topic],array['NeetCode 150'],c.source_url
from manor_private.leetcode_curriculum c on conflict(id) do nothing;
drop function manor_private.seed_curriculum() cascade;
drop table manor_private.leetcode_curriculum;

alter table public.problem_content_versions add constraint problem_content_versions_problem_id_fkey foreign key(problem_id) references public.leetcode_problems(id) on delete cascade;
alter table manor_private.problem_testsets add constraint problem_testsets_content_fkey foreign key(problem_id,content_version) references public.problem_content_versions(problem_id,version) on delete cascade;
alter table public.problem_code_drafts add constraint problem_code_drafts_content_fkey foreign key(problem_id,content_version) references public.problem_content_versions(problem_id,version) on delete cascade;
alter table public.problem_submissions add constraint problem_submissions_content_fkey foreign key(problem_id,content_version) references public.problem_content_versions(problem_id,version) on delete cascade;
alter table public.leetcode_attempts add constraint leetcode_attempts_problem_id_fkey foreign key(problem_id) references public.leetcode_problems(id) on delete cascade;
alter table manor_private.problem_editor_sessions add constraint problem_editor_sessions_problem_id_fkey foreign key(problem_id) references public.leetcode_problems(id) on delete cascade;
alter table public.leetcode_problems enable trigger manor_workspace_changes,enable trigger manor_history,enable trigger problem_canonical_guard;

create table public.problem_practice (
 user_id uuid not null references auth.users(id) on delete cascade,
 problem_id text not null references public.leetcode_problems(id) on delete cascade,
 status text not null check(status in ('attempted','solved')),
 revision bigint not null default 1,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,problem_id)
);
create index problem_practice_problem on public.problem_practice(problem_id);
insert into public.problem_practice(user_id,problem_id,status,updated_at) select user_id,problem_id,status,updated_at from catalog_practice;
alter table public.problem_practice enable row level security;
revoke all on public.problem_practice from public,anon,authenticated;
grant select on public.problem_practice to authenticated,manor_commands;
grant all on public.problem_practice to service_role;
create policy problem_practice_owner_read on public.problem_practice for select to authenticated,manor_commands using(user_id=(select auth.uid()));

-- Content versions take their owner from the problem, never from input: null for the catalog.
create function manor_private.problem_content_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select p.user_id into new.user_id from public.leetcode_problems p where p.id=new.problem_id;
 return new;
end $$;
revoke all on function manor_private.problem_content_owner() from public;
create trigger problem_content_owner before insert on public.problem_content_versions for each row execute function manor_private.problem_content_owner();
create trigger manor_workspace_changes after insert or update or delete on public.problem_content_versions for each row execute function manor_private.record_workspace_change();
create trigger manor_workspace_changes after insert or update or delete on public.problem_practice for each row execute function manor_private.record_workspace_change();

-- Accounts read the catalog and their own custom problems; account commands write only their own rows.
drop policy leetcode_problems_owner on public.leetcode_problems;
create policy problem_read on public.leetcode_problems for select to authenticated using(user_id is null or user_id=(select auth.uid()));
create policy problem_catalog_command_read on public.leetcode_problems for select to manor_commands using(user_id is null);
drop policy problem_read_owner on public.problem_content_versions;
create policy problem_read on public.problem_content_versions for select to authenticated using(user_id is null or user_id=(select auth.uid()));
create policy problem_catalog_command_read on public.problem_content_versions for select to manor_commands using(user_id is null);

create view public.problem_catalog with (security_invoker=true) as
select p.* from public.leetcode_problems p where p.user_id is null;
create view public.problem_catalog_content with (security_invoker=true) as
select c.* from public.problem_content_versions c join public.leetcode_problems p on p.id=c.problem_id and p.content_version=c.version where p.user_id is null;
revoke all on public.problem_catalog,public.problem_catalog_content from public,anon,authenticated;
grant select on public.problem_catalog,public.problem_catalog_content to authenticated,service_role;

-- The catalog feed: one contiguous cursor for the whole catalog, shaped like the workspace feed. The app reads it as
-- a signed-in account; the snapshot tooling reads the cursor as postgres or the service role.
create table manor_private.catalog_change_heads (singleton boolean primary key default true check(singleton),cursor bigint not null);
insert into manor_private.catalog_change_heads(singleton,cursor) values(true,0);
create table manor_private.catalog_changes (
 cursor bigint primary key,
 object_type text not null check(object_type in ('problem_catalog','problem_catalog_content')),
 object_key jsonb not null,
 change text not null check(change in ('insert','update','delete')),
 revision bigint,
 occurred_at timestamptz not null default clock_timestamp()
);
create table manor_private.catalog_receipts (
 command_id uuid primary key,
 operation text not null,
 input_hash text not null,
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
revoke all on manor_private.catalog_change_heads,manor_private.catalog_changes,manor_private.catalog_receipts from public,anon,authenticated;

-- A row entering or leaving the catalog, or changing in it, appends a `problem_catalog` change; a new or removed
-- statement version also appends a `problem_catalog_content` change, which carries no revision so it is always re-read.
create function manor_private.record_catalog_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rid text; was_catalog boolean; is_catalog boolean; change_kind text; row_revision bigint; content_moved boolean; next_cursor bigint;
begin
 if tg_op='INSERT' then rid:=new.id; was_catalog:=false; is_catalog:=new.user_id is null; content_moved:=new.content_version>0; row_revision:=new.revision;
 elsif tg_op='DELETE' then rid:=old.id; was_catalog:=old.user_id is null; is_catalog:=false; content_moved:=old.content_version>0; row_revision:=old.revision;
 else
  if to_jsonb(old)=to_jsonb(new) then return new; end if;
  rid:=new.id; was_catalog:=old.user_id is null; is_catalog:=new.user_id is null; content_moved:=new.content_version<>old.content_version; row_revision:=new.revision;
 end if;
 if not was_catalog and not is_catalog then return coalesce(new,old); end if;
 change_kind:=case when not is_catalog then 'delete' when not was_catalog then 'insert' else 'update' end;
 update manor_private.catalog_change_heads set cursor=cursor+1 returning cursor into next_cursor;
 insert into manor_private.catalog_changes(cursor,object_type,object_key,change,revision) values(next_cursor,'problem_catalog',jsonb_build_object('id',rid),change_kind,row_revision);
 if content_moved or change_kind<>'update' then
  update manor_private.catalog_change_heads set cursor=cursor+1 returning cursor into next_cursor;
  insert into manor_private.catalog_changes(cursor,object_type,object_key,change,revision) values(next_cursor,'problem_catalog_content',jsonb_build_object('problem_id',rid),change_kind,null);
 end if;
 return coalesce(new,old);
end $$;
revoke all on function manor_private.record_catalog_change() from public;
create trigger manor_catalog_changes after insert or update or delete on public.leetcode_problems for each row execute function manor_private.record_catalog_change();

create function public.manor_catalog_cursor() returns bigint language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null and session_user<>'postgres' and (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if (select auth.jwt()->>'client_id') is not null then raise exception using errcode='42501',message='The Manor catalog mirror is a first-party application capability. Read problems with the query_problems and read_problem tools instead.'; end if;
 return (select h.cursor from manor_private.catalog_change_heads h);
end $$;
create function public.manor_catalog_changes(p_since bigint,p_limit integer) returns table(cursor bigint,object_type text,object_key jsonb,change text,revision bigint,occurred_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null and session_user<>'postgres' and (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if (select auth.jwt()->>'client_id') is not null then raise exception using errcode='42501',message='The Manor catalog mirror is a first-party application capability. Read problems with the query_problems and read_problem tools instead.'; end if;
 if p_since is null or p_since<0 then raise exception using errcode='22023',message='Pull catalog changes from cursor 0 or the last catalog cursor the mirror recorded, not '||coalesce(p_since::text,'null'); end if;
 if p_limit is null then raise exception using errcode='22023',message='Pulling catalog changes requires a row limit; it is clamped to 1 through 1000'; end if;
 return query select c.cursor,c.object_type,c.object_key,c.change,c.revision,c.occurred_at
  from manor_private.catalog_changes c where c.cursor>p_since order by c.cursor limit least(greatest(p_limit,1),1000);
end $$;
revoke all on function public.manor_catalog_cursor(),public.manor_catalog_changes(bigint,integer) from public,anon;
grant execute on function public.manor_catalog_cursor(),public.manor_catalog_changes(bigint,integer) to authenticated,service_role;

insert into storage.buckets(id,name,public) values('manor-catalog','manor-catalog',false);
create policy manor_catalog_read on storage.objects for select to authenticated using(bucket_id='manor-catalog');

-- Workspace feed identities carry problem and version keys, for practice rows and custom statement versions.
create or replace function manor_private.record_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; owner_id uuid; next_cursor bigint; identity_fields jsonb;
begin
 if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 owner_id:=(r->>'user_id')::uuid;
 -- Account cascades must not recreate a head after the owner was deleted, and catalog rows have no owner.
 if not exists(select 1 from auth.users where id=owner_id) then return coalesce(new,old); end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into identity_fields from jsonb_each(r)
 where key in ('id','habit_id','date','account_id','calendar_id','note_id','revision','object_type','object_id','provider','month','problem_id','version');
 insert into manor_private.workspace_change_heads(user_id,cursor) values(owner_id,1)
 on conflict(user_id) do update set cursor=manor_private.workspace_change_heads.cursor+1 returning cursor into next_cursor;
 insert into manor_private.workspace_changes(user_id,cursor,object_type,object_key,change,revision)
 values(owner_id,next_cursor,tg_table_name,identity_fields,case when tg_table_name='purge_tombstones' then 'purge' else lower(tg_op) end,(r->>'revision')::bigint);
 return coalesce(new,old);
end $$;

-- Guards. Duplicate groups stay flat and share one owner and kind; the check constraints keep catalog aliases
-- imported under a stock or imported canonical, and custom aliases under a custom canonical.
create or replace function manor_private.guard_problem_canonical() returns trigger language plpgsql security definer set search_path='' as $$
declare target public.leetcode_problems; group_id text; key text; combined integer;
begin
 if new.canonical_problem_id is not null then
  select * into target from public.leetcode_problems where id=new.canonical_problem_id for update;
  if target.id is null or target.canonical_problem_id is not null or target.kind<>new.kind or target.user_id is distinct from new.user_id then raise exception 'A duplicate must reference an ungrouped canonical problem with the same owner and kind'; end if;
  if exists(select 1 from public.leetcode_problems where canonical_problem_id=new.id) then raise exception 'Duplicate groups must stay flat; unmerge this group before regrouping it'; end if;
 end if;
 group_id:=coalesce(new.canonical_problem_id,new.id);
 if exists(select 1 from public.leetcode_problems where canonical_problem_id=group_id and id<>new.id and kind<>new.kind) then raise exception 'Retained duplicate sources must have the same kind'; end if;
 if new.canonical_problem_id is not null or exists(select 1 from public.leetcode_problems where canonical_problem_id=new.id) then
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select count(distinct label) from (select unnest(p.%I) label from public.leetcode_problems p where id<>$1 and (id=$2 or canonical_problem_id=$2) union all select jsonb_array_elements_text($3->$4)) labels',key)
    into combined using new.id,group_id,to_jsonb(new),key;
   if combined>(case when key='companies' then 1000 else 100 end) then raise exception 'Combined % labels exceed the duplicate-group catalog limit',key; end if;
  end loop;
 end if;
 return new;
end $$;

-- New practice work needs a problem the account can read that is not grouped under another. Work that already
-- exists keeps its target, so a grouped source's in-flight submissions finish and its history stays editable.
create or replace function manor_private.guard_problem_practice_target() returns trigger language plpgsql security definer set search_path='' as $$
declare target public.leetcode_problems;
begin
 if tg_op='UPDATE' and new.problem_id is not distinct from old.problem_id then return new; end if;
 select * into target from public.leetcode_problems where id=new.problem_id and (user_id is null or user_id=new.user_id) for share;
 if target.id is null then raise exception using errcode='P0002',message='The practice problem does not exist or is not available to this account'; end if;
 if target.canonical_problem_id is not null then raise exception using errcode='PT409',message='This source is grouped with problem '||target.canonical_problem_id||'. Open the canonical problem before saving practice work.'; end if;
 return new;
end $$;

-- Writes to an existing problem require its owner: an account writes only its own custom problems, and the catalog
-- path (no owner) writes only catalog problems.
create function manor_private.require_problem_owner(p_problem public.leetcode_problems,p_owner uuid) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_problem.id is null or p_problem.user_id is not distinct from p_owner then return; end if;
 if p_problem.user_id is null then raise exception using errcode='42501',message='Manor catalog problems are read-only.'; end if;
 if p_owner is null then raise exception using errcode='23505',message='Problem '||p_problem.id||' is a custom problem; the catalog never writes it'; end if;
 raise exception using errcode='P0002',message='Problem '||p_problem.id||' is not owned by this account';
end $$;
alter function manor_private.require_problem_owner(public.leetcode_problems,uuid) owner to manor_commands;
revoke all on function manor_private.require_problem_owner(public.leetcode_problems,uuid) from public;

-- The single problem writer. Accounts pass their own ID and save custom problems; catalog_command passes null and
-- saves stock and imported problems. Any other source type is an error, never coerced.
drop function manor_private.save_problem(jsonb);
create function manor_private.save_problem(p jsonb,p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
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
 select * into existing from public.leetcode_problems where id=rid for update;
 perform manor_private.require_problem_owner(existing,p_owner);
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
alter function manor_private.save_problem(jsonb,uuid) owner to manor_commands;
revoke all on function manor_private.save_problem(jsonb,uuid) from public;

-- Testsets number per problem. The account path may write only its own custom problems; the service path writes
-- any problem. The problem's grading version follows the newest testset for its current statement.
create or replace function manor_private.save_problem_testset(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid text:=p->>'problemId'; cv integer:=(p->>'contentVersion')::integer; v integer; c jsonb; token text; numeric_value double precision; latest manor_private.problem_testsets; target public.leetcode_problems; result jsonb;
begin
 if rid is null or length(rid)=0 or cv is null or cv<=0 then raise exception 'A testset requires a problem and positive content version'; end if;
 select * into target from public.leetcode_problems where id=rid;
 if target.id is null then raise exception using errcode='P0002',message='Problem '||rid||' does not exist'; end if;
 if auth.uid() is not null and target.user_id is distinct from auth.uid() then raise exception using errcode='42501',message='A testset must belong to a custom problem of the signed-in account'; end if;
 if p->>'checker' is null or p->>'provenance' is null or p->>'checker' not in ('exact','trimmed','json','numeric','json_unordered','json_unordered_deep','json_tolerant','special') or p->>'provenance' not in ('generated','source','user') then raise exception 'A testset requires a supported checker and provenance'; end if;
 if (p->>'checker'='special') <> (jsonb_typeof(p->'judge')='string') or octet_length(coalesce(p->>'judge',''))>65536 then raise exception 'A special checker requires judge source of at most 64 KiB, and only special checkers carry one'; end if;
 if jsonb_typeof(p->'cases') is distinct from 'array' or jsonb_array_length(p->'cases') not between 1 and 200 then raise exception 'A testset requires between 1 and 200 cases'; end if;
 for c in select value from jsonb_array_elements(p->'cases') loop
  if jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or jsonb_typeof(c->'input') is distinct from 'string' or jsonb_typeof(c->'expectedOutput') is distinct from 'string' or jsonb_typeof(c->'hidden') is distinct from 'boolean' then raise exception 'Every case requires id, input, expectedOutput, and hidden'; end if;
  if octet_length(c->>'input')>1048576 or octet_length(c->>'expectedOutput')>65536 then raise exception 'A case exceeds the input or answer size limit'; end if;
  if p->>'checker' in ('json','json_unordered','json_unordered_deep','json_tolerant','special') then
   perform (c->>'expectedOutput')::jsonb;
   if p->>'checker' in ('json_unordered','json_unordered_deep') and jsonb_typeof((c->>'expectedOutput')::jsonb) is distinct from 'array' then raise exception 'The unordered JSON checker requires a top-level answer array'; end if;
  end if;
  if p->>'checker'='numeric' then
   if btrim(c->>'expectedOutput', E' \t\n\r')='' then raise exception 'The numeric checker requires at least one finite answer'; end if;
   for token in select unnest(regexp_split_to_array(btrim(c->>'expectedOutput', E' \t\n\r'), E'\\s+')) loop
    if token !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then raise exception 'The numeric checker answer contains a nonnumeric token'; end if;
    numeric_value := token::double precision;
    if numeric_value in ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) then raise exception 'The numeric checker requires finite answers'; end if;
   end loop;
  end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'cases'))<>jsonb_array_length(p->'cases') then raise exception 'Case IDs must be unique'; end if;
 perform pg_advisory_xact_lock(hashtextextended('problem-testset'||rid,0));
 if not p ? 'version' then
  select * into latest from manor_private.problem_testsets where problem_id=rid order by version desc limit 1;
  if found and latest.content_version=cv and latest.checker=p->>'checker' and latest.provenance=p->>'provenance' and latest.cases=p->'cases' and latest.judge is not distinct from p->>'judge' then
   v:=latest.version;
   result:=jsonb_build_object('testsetVersion',v,'count',jsonb_array_length(p->'cases'),'unchanged',true);
  end if;
 end if;
 if result is null then
  select coalesce(max(version),0)+1 into v from manor_private.problem_testsets where problem_id=rid;
  if p ? 'version' and (p->>'version')::integer<>v then raise exception 'The next testset version is %',v; end if;
  insert into manor_private.problem_testsets(problem_id,content_version,version,checker,provenance,cases,judge) values(rid,cv,v,p->>'checker',p->>'provenance',p->'cases',p->>'judge');
  result:=jsonb_build_object('testsetVersion',v,'count',jsonb_array_length(p->'cases'));
 end if;
 update public.leetcode_problems set grading_version=v,revision=revision+1,updated_at=clock_timestamp() where id=rid and content_version=cv and grading_version is distinct from v;
 return result;
end $$;

-- An account's status for one problem comes from its own attempts and practice on that problem alone; a grouped
-- source's history never counts toward its canonical problem.
create function manor_private.problem_status(rid text) returns text language sql stable set search_path='' as $$
 select case when exists(select 1 from public.leetcode_attempts a where a.user_id=auth.uid() and a.problem_id=rid) then 'solved'
  else coalesce((select pp.status from public.problem_practice pp where pp.user_id=auth.uid() and pp.problem_id=rid),'unattempted') end
$$;
alter function manor_private.problem_status(text) owner to manor_commands;
revoke all on function manor_private.problem_status(text) from public;

create function manor_private.problem_record(p public.leetcode_problems) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(p)-'user_id'||jsonb_build_object('catalog',p.user_id is null,'status',manor_private.problem_status(p.id))
$$;
alter function manor_private.problem_record(public.leetcode_problems) owner to manor_commands;
revoke all on function manor_private.problem_record(public.leetcode_problems) from public;

create or replace function manor_private.problem_group_record(rid text) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.leetcode_problems; result jsonb; key text; labels jsonb;
begin
 select * into p from public.leetcode_problems where id=rid and (user_id is null or user_id=auth.uid());
 if p.id is null then raise exception using errcode='P0002',message='Problem does not exist or is not available to this account'; end if;
 result:=manor_private.problem_record(p);
 if p.canonical_problem_id is null and exists(select 1 from public.leetcode_problems where canonical_problem_id=p.id) then
  foreach key in array array['topics','tags','collections','companies'] loop
   execute format('select coalesce(jsonb_agg(label order by label),''[]''::jsonb) from (select distinct unnest(p.%I) label from public.leetcode_problems p where id=$1 or canonical_problem_id=$1) labels',key) into labels using p.id;
   result:=jsonb_set(result,array[key],labels);
  end loop;
 end if;
 return result;
end $$;

drop function manor_private.problem_has_protected_work(text);

-- Duplicate groups. Catalog groups (no owner, through catalog_command) keep imported sources under a stock or
-- imported canonical; custom groups keep an account's own custom problems together. Practice never blocks a merge:
-- a source's attempts, submissions, drafts, and editor sessions stay where they are and stop counting.
create function manor_private.problem_duplicate_group(op text,p jsonb,p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
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
  select * into alias_row from public.leetcode_problems where id=p->>'id' for update;
  perform manor_private.require_problem_owner(alias_row,p_owner);
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
alter function manor_private.problem_duplicate_group(text,jsonb,uuid) owner to manor_commands;
revoke all on function manor_private.problem_duplicate_group(text,jsonb,uuid) from public;

-- Account duplicate commands group the caller's own custom problems.
create or replace function manor_private.problem_duplicate_command(op text,p jsonb) returns jsonb language sql set search_path='' as $$
 select manor_private.problem_duplicate_group(op,p,auth.uid())
$$;

create or replace function manor_private.problem_library_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; result jsonb; outcomes jsonb:='[]'; draft public.problem_code_drafts; current_version integer; view_row public.saved_problem_views; filters jsonb; sort_item jsonb; columns_value text[]; key text;
begin
 if op='save_problem_draft' then
  if p->>'language' is null or p->>'language' not in ('cpp','c','python','javascript','java','go') or jsonb_typeof(p->'source') is distinct from 'string' or octet_length(p->>'source')>262144 then raise exception 'Code draft requires a supported language and source of at most 262144 UTF-8 bytes'; end if;
  select content_version into current_version from public.leetcode_problems where id=p->>'problem_id' and kind='coding' and (user_id is null or user_id=auth.uid());
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
 elsif op='save_problem' then return manor_private.save_problem(p,auth.uid());
 elsif op='import_problems' then
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 100 then raise exception 'Import requires 1 to 100 problems per atomic batch'; end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   result:=manor_private.save_problem(item,auth.uid());
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
  select * into requested from public.leetcode_problems where id=p_input->>'id' and (user_id is null or user_id=auth.uid());
  if requested.id is null then raise exception using errcode='P0002',message='Problem does not exist or is not available to this account'; end if;
  canonical_id:=coalesce(requested.canonical_problem_id,requested.id);
  problem:=manor_private.problem_group_record(canonical_id);
  select to_jsonb(c)-'user_id' into content from public.problem_content_versions c where problem_id=canonical_id and version=(problem->>'content_version')::integer;
  select to_jsonb(c)-'user_id' into requested_content from public.problem_content_versions c where problem_id=requested.id and version=requested.content_version;
  select jsonb_agg(manor_private.problem_record(p) order by p.id) into sources from public.leetcode_problems p where id=canonical_id or canonical_problem_id=canonical_id;
  can_grade:=problem->>'kind'='coding' and problem->>'grading_version' is not null;
  return jsonb_build_object('problem',problem,'content',content,'can_execute',can_grade or (problem->>'kind'='coding' and problem->>'source_type'='custom' and content is not null),'grading_available',can_grade,'requested_id',requested.id,'requested_problem',manor_private.problem_record(requested),'requested_content',requested_content,'source_records',sources);
 elsif p_query='list_problem_views' then
  select coalesce(jsonb_agg(to_jsonb(v)-'user_id' order by id),'[]') into items from (select * from public.saved_problem_views where user_id=auth.uid() and id>after_id order by id limit take) v;
 elsif p_query='query_problems' then
  if p_input->>'status' is not null and p_input->>'status' not in ('unattempted','attempted','solved') then raise exception 'Problem status filter is invalid'; end if;
  if p_input->>'last_asked_since' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_since','precision','day'),false); end if;
  if p_input->>'last_asked_until' is not null then perform manor_private.problem_source_date(jsonb_build_object('value',p_input->>'last_asked_until','precision','day'),false); end if;
  if p_input->>'last_asked_since'>p_input->>'last_asked_until' then raise exception 'Recency date range is reversed'; end if;
  with matched as materialized (
   select p.id from public.leetcode_problems p where (p.user_id is null or p.user_id=auth.uid()) and p.canonical_problem_id is null
   and (p_input->>'search' is null or p.name ilike '%'||(p_input->>'search')||'%' or p.source_name ilike '%'||(p_input->>'search')||'%' or exists(select 1 from public.leetcode_problems s where s.canonical_problem_id=p.id and (s.name ilike '%'||(p_input->>'search')||'%' or s.source_name ilike '%'||(p_input->>'search')||'%')))
   and (p_input->>'kind' is null or p.kind=p_input->>'kind')
   and (p_input->>'difficulty' is null or p.difficulty=p_input->>'difficulty')
   and (p_input->>'source_type' is null or p.source_type=p_input->>'source_type')
   and (p_input->>'topic' is null or p.topics @> array[p_input->>'topic'] or exists(select 1 from public.leetcode_problems s where s.canonical_problem_id=p.id and s.topics @> array[p_input->>'topic']))
   and (p_input->>'company' is null or p.companies @> array[p_input->>'company'] or exists(select 1 from public.leetcode_problems s where s.canonical_problem_id=p.id and s.companies @> array[p_input->>'company']))
   and (p_input->>'tag' is null or p.tags @> array[p_input->>'tag'] or exists(select 1 from public.leetcode_problems s where s.canonical_problem_id=p.id and s.tags @> array[p_input->>'tag']))
   and (p_input->>'collection' is null or p.collections @> array[p_input->>'collection'] or exists(select 1 from public.leetcode_problems s where s.canonical_problem_id=p.id and s.collections @> array[p_input->>'collection']))
   and (p_input->>'status' is null or manor_private.problem_status(p.id)=p_input->>'status')
   and (not(p_input?'has_content') or p.content_available=(p_input->>'has_content')::boolean)
   and ((p_input->>'last_asked_since' is null and p_input->>'last_asked_until' is null) or exists(select 1 from public.leetcode_problems s where (s.id=p.id or s.canonical_problem_id=p.id)
    and (p_input->>'last_asked_since' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',true)>=(p_input->>'last_asked_since')::date)
    and (p_input->>'last_asked_until' is null or manor_private.problem_source_date(s.source_metadata->'lastAsked',false)<=(p_input->>'last_asked_until')::date)))
  ), page as (select * from matched where id>after_id order by id limit take)
  select coalesce((select jsonb_agg(manor_private.problem_group_record(id) order by id) from page),'[]'),(select count(*) from matched) into items,total;
 else raise exception 'Unsupported problem query: %',p_query;
 end if;
 return jsonb_build_object('items',items,'total',total,'next_cursor',case when jsonb_array_length(items)=take then items->-1->>'id' end);
end $$;

-- Deleting catalog problems removes everything practiced on them: through the cascades, every account's attempts,
-- submissions, drafts, editor sessions, practice rows, statement versions, and testsets go with each problem.
-- Mistakes notes have no problem link and stay. Input: {"ids": [...]}, 1 to 100 catalog problem IDs. Rule: a
-- canonical problem is deleted only together with every source still grouped under it, in the same command;
-- unmerge a source first to keep it. Attempt removals are recorded in each account's action history.
create function manor_private.delete_catalog_problems(p_command_id uuid,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare ids text[]; problem text; source text;
begin
 if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') not between 1 and 100 or exists(select 1 from jsonb_array_elements(p->'ids') value where jsonb_typeof(value)<>'string') then raise exception 'Deleting catalog problems requires 1 to 100 problem IDs'; end if;
 ids:=array(select distinct value from jsonb_array_elements_text(p->'ids') value order by value);
 perform 1 from public.leetcode_problems where id=any(ids) order by id for update;
 select requested into problem from unnest(ids) requested where not exists(select 1 from public.leetcode_problems c where c.id=requested and c.user_id is null) order by requested limit 1;
 if problem is not null then raise exception using errcode='P0002',message='Catalog problem '||problem||' does not exist'; end if;
 select a.canonical_problem_id,a.id into problem,source from public.leetcode_problems a where a.canonical_problem_id=any(ids) and not a.id=any(ids) order by a.canonical_problem_id,a.id limit 1;
 if problem is not null then raise exception using errcode='PT409',message='Problem '||problem||' still groups source '||source||'. Unmerge that source or delete it in the same command.'; end if;
 perform set_config('manor.command_id',p_command_id::text,true);
 perform set_config('manor.operation','delete_problem',true);
 perform set_config('manor.actor','background',true);
 perform set_config('manor.provenance','',true);
 delete from public.leetcode_attempts where problem_id=any(ids);
 perform set_config('manor.command_id','',true);
 delete from public.leetcode_problems where id=any(ids);
 return jsonb_build_object('deleted',to_jsonb(ids));
end $$;
revoke all on function manor_private.delete_catalog_problems(uuid,jsonb) from public;

-- The only catalog writer, for Manor's operator tooling (service role, or postgres through the Management API).
-- Operations: import_problems ({"items": [...]}, 1 to 100), save_problem, merge_problem_duplicates,
-- unmerge_problem_duplicate, and delete_problem. Receipts make a command ID replay its first response.
create function manor_private.catalog_command(p_command_id uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt manor_private.catalog_receipts; fingerprint text; result jsonb; item jsonb; outcomes jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception using errcode='42501',message='Manor catalog problems change only through Manor import tooling'; end if;
 if p_command_id is null or p_operation is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'A catalog command requires an ID, operation, and object input'; end if;
 perform pg_advisory_xact_lock(hashtext('manor-catalog'));
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
revoke all on function manor_private.catalog_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function manor_private.catalog_command(uuid,text,jsonb) to service_role;

-- Every catalog row changed owner, so plans need fresh statistics before the first query: without them the planner
-- estimates one catalog row and chooses nested sequential scans.
analyze public.leetcode_problems,public.problem_content_versions,manor_private.problem_testsets,public.problem_practice;

-- Execution reads catalog problems and the account's own custom problems; practice moves to problem_practice.
create or replace function public.manor_problem_runner(p_action text,p_owner uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.problem_submissions; j manor_private.problem_execution_jobs; t manor_private.problem_testsets; c jsonb; batch jsonb; result jsonb; cv integer; rid text; sid uuid; failure text; count_pass integer; request_hash_value text; spec jsonb; tz text; attempt_day date; width integer; lines text[];
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Problem execution is managed by the server'; end if;
 if p_action not in ('claim','editor_expired') and p_owner is null then raise exception 'An account is required for this execution action'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Execution input must be an object'; end if;
 if p_action='enqueue' then
  if jsonb_typeof(p_input->'code') is distinct from 'string' or jsonb_typeof(p_input->'problemId') is distinct from 'string' or p_input->>'requestId' is null then raise exception 'Execution requires a problem, program source, and request ID'; end if;
  if p_input ? 'customInput' and jsonb_typeof(p_input->'customInput') is distinct from 'string' then raise exception 'Custom input must be text'; end if;
  request_hash_value:=encode(pg_catalog.sha256(convert_to(p_input::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'problem-execution',0));
  select * into s from public.problem_submissions where user_id=p_owner and request_id=(p_input->>'requestId')::uuid;
  if found then
   if s.request_hash<>request_hash_value then raise exception 'This execution request ID was already used for different input'; end if;
   return manor_private.problem_submission_json(s);
  end if;
  rid:=p_input->>'problemId';
  select content_version into cv from public.leetcode_problems where id=rid and kind='coding' and (user_id is null or user_id=p_owner);
  select c.interface into spec from public.problem_content_versions c where c.problem_id=rid and c.version=cv;
  if cv is null or cv=0 then raise exception 'This problem has no executable content'; end if;
  if p_input->>'language' is null or p_input->>'mode' is null or p_input->>'language' not in ('cpp','c','python','javascript','java','go') or p_input->>'mode' not in ('run','submit') then raise exception 'Unsupported execution language or mode'; end if;
  if octet_length(p_input->>'code') not between 1 and 262144 then raise exception 'Program source must contain between 1 byte and 256 KiB'; end if;
  if spec is not null and p_input->>'language'='c' then raise exception 'C is not available for this problem. Choose C++, Python, JavaScript, Java, or Go'; end if;
  if (select count(*) from public.problem_submissions where user_id=p_owner and status in ('queued','running'))>=4 then raise exception 'Four executions are already pending. Wait for one to finish'; end if;
  if p_input ? 'customInput' and p_input->>'mode'='run' then
   if octet_length(p_input->>'customInput')>1048576 then raise exception 'Custom input must be at most 1 MiB'; end if;
   if spec is null then
    batch:=jsonb_build_array(jsonb_build_object('id','custom','input',p_input->>'customInput','expectedOutput',null,'hidden',false));
   else
    -- Typed custom input holds several cases back to back: one line per parameter, one line for a codec value, or two lines for a class.
    width:=case spec->>'kind' when 'function' then jsonb_array_length(spec->'params') when 'codec' then 1 else 2 end;
    lines:=array(select line from regexp_split_to_table(p_input->>'customInput',E'\n') line where btrim(line,E' \t\r')<>'');
    if width<1 or cardinality(lines)=0 or cardinality(lines)%width<>0 then raise exception 'Each test case needs % input lines, one JSON value per line',width; end if;
    if cardinality(lines)/width>50 then raise exception 'Custom runs accept at most 50 test cases'; end if;
    select jsonb_agg(jsonb_build_object('id','custom-'||n,'input',array_to_string(lines[(n-1)*width+1:n*width],E'\n')||E'\n','expectedOutput',null,'hidden',false) order by n) into batch from generate_series(1,cardinality(lines)/width) n;
   end if;
   t.checker:='trimmed'; t.judge:=null;
  else
   select * into t from manor_private.problem_testsets where problem_id=rid and content_version=cv order by version desc limit 1;
   if not found then raise exception 'This problem needs a verified testset before it can run'; end if;
   select jsonb_agg(value) into batch from jsonb_array_elements(t.cases) where p_input->>'mode'='submit' or not (value->>'hidden')::boolean;
   if batch is null then raise exception 'This testset has no public examples. Use custom input or Submit'; end if;
  end if;
  insert into public.problem_submissions(user_id,problem_id,content_version,testset_version,language,mode,total_cases,request_id,request_hash,source_code) values(p_owner,rid,cv,t.version,p_input->>'language',p_input->>'mode',jsonb_array_length(batch),(p_input->>'requestId')::uuid,request_hash_value,p_input->>'code') returning * into s;
  insert into manor_private.problem_execution_jobs(user_id,submission_id,code,cases,checker,interface,judge) values(p_owner,s.id,p_input->>'code',batch,t.checker,spec,t.judge);
  insert into public.problem_practice(user_id,problem_id,status) values(p_owner,rid,'attempted') on conflict(user_id,problem_id) do nothing;
  return manor_private.problem_submission_json(s);
 elsif p_action='read' then
  select * into s from public.problem_submissions where user_id=p_owner and id=(p_input->>'submissionId')::uuid;
  if not found then raise exception 'Submission not found'; end if;
  return manor_private.problem_submission_json(s)||jsonb_build_object('sourceCode',s.source_code);
 elsif p_action='list' then
  return coalesce((select jsonb_agg(manor_private.problem_submission_json(r)) from (select * from public.problem_submissions where user_id=p_owner and problem_id=p_input->>'problemId' order by created_at desc limit 50) r),'[]'::jsonb);
 elsif p_action in ('claim','claim_submission') then
  update public.problem_submissions s0 set status='failed',verdict='execution_error',error='Execution could not complete after three worker attempts',finished_at=now() from manor_private.problem_execution_jobs j0 where s0.user_id=j0.user_id and s0.id=j0.submission_id and s0.status in ('queued','running') and j0.attempts>=3 and coalesce(j0.leased_until,'-infinity')<now();
  delete from manor_private.problem_execution_jobs j0 using public.problem_submissions s0 where s0.user_id=j0.user_id and s0.id=j0.submission_id and s0.status in ('completed','failed');
  select j0.* into j from manor_private.problem_execution_jobs j0 join public.problem_submissions s0 on s0.user_id=j0.user_id and s0.id=j0.submission_id where s0.status in ('queued','running') and j0.attempts<3 and j0.next_attempt_at<=now() and coalesce(j0.leased_until,'-infinity')<now() and (p_action='claim' or (s0.user_id=p_owner and s0.id=(p_input->>'submissionId')::uuid)) order by s0.created_at for update of j0 skip locked limit 1;
  if not found then return null; end if;
  update manor_private.problem_execution_jobs set lease_token=gen_random_uuid(),leased_until=now()+interval '150 seconds',attempts=attempts+1 where user_id=j.user_id and submission_id=j.submission_id returning * into j;
  update public.problem_submissions set status='running' where user_id=j.user_id and id=j.submission_id returning * into s;
  -- Typed drivers judge many cases in one process, so a lease carries the whole remaining testset.
  select jsonb_agg(value) into batch from jsonb_array_elements(j.cases) with ordinality where ordinality>j.cursor and ordinality<=j.cursor+case when j.interface is null then 4 else 200 end;
  return jsonb_build_object('submission',manor_private.problem_submission_json(s),'owner',j.user_id,'leaseToken',j.lease_token,'code',j.code,'checker',j.checker,'cases',batch,'interface',j.interface,'judge',j.judge);
 elsif p_action in ('complete','fail') then
  sid:=(p_input->>'submissionId')::uuid;
  select * into j from manor_private.problem_execution_jobs where user_id=p_owner and submission_id=sid for update;
  if not found or j.lease_token is distinct from (p_input->>'leaseToken')::uuid or j.leased_until<now() then raise exception 'Execution lease expired or was replaced'; end if;
  select * into s from public.problem_submissions where user_id=p_owner and id=sid for update;
  if p_action='fail' then
   failure:=left(p_input->>'error',2000);
   update public.problem_submissions set status='failed',verdict='execution_error',error=failure,finished_at=now() where user_id=p_owner and id=sid returning * into s;
  else
   batch:=p_input->'results';
   if jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)=0 then raise exception 'Worker returned no case results'; end if;
   result:='[]'::jsonb;
   for c in select value from jsonb_array_elements(batch) loop
    if not exists(select 1 from jsonb_array_elements(j.cases) original where original->>'id'=c->>'id') then raise exception 'Worker returned an unexpected case ID'; end if;
    if (c->>'hidden')::boolean then c:=c||jsonb_build_object('input',null,'expectedOutput',null,'output',null,'stderr',null); end if;
    result:=result||jsonb_build_array(c);
   end loop;
   select count(*) into count_pass from jsonb_array_elements(result) where (value->>'passed')::boolean;
   s.results:=s.results||result; s.passed_cases:=s.passed_cases+count_pass;
   failure:=(select value->>'verdict' from jsonb_array_elements(s.results) where value->>'verdict'<>'accepted' limit 1);
   if failure='compile_error' or jsonb_array_length(s.results)>=s.total_cases then
    update public.problem_submissions set results=s.results,passed_cases=s.passed_cases,status='completed',verdict=coalesce(failure,'accepted'),finished_at=now() where user_id=p_owner and id=sid returning * into s;
   else
    update public.problem_submissions set results=s.results,passed_cases=s.passed_cases,status='queued' where user_id=p_owner and id=sid returning * into s;
    update manor_private.problem_execution_jobs set cursor=cursor+jsonb_array_length(result),attempts=0,lease_token=null,leased_until=null where user_id=p_owner and submission_id=sid;
   end if;
  end if;
  -- A source grouped while its submission ran still gets its verdict, but its practice no longer counts anywhere.
  if s.status='completed' and s.mode='submit' and s.verdict='accepted' and not exists(select 1 from public.leetcode_problems g where g.id=s.problem_id and g.canonical_problem_id is not null) then
   insert into public.problem_practice(user_id,problem_id,status) values(p_owner,s.problem_id,'solved')
   on conflict(user_id,problem_id) do update set status='solved',revision=public.problem_practice.revision+1,updated_at=clock_timestamp() where public.problem_practice.status<>'solved';
   -- An accepted submission is a solve: it is logged as a dated attempt with its exact source, once per day and source.
   select timezone into tz from public.profiles where user_id=p_owner;
   attempt_day:=(now() at time zone coalesce(tz,'UTC'))::date;
   if not exists(select 1 from public.leetcode_attempts a where a.user_id=p_owner and a.problem_id=s.problem_id and a.date=attempt_day and a.solution=s.source_code and a.deleted_at is null) then
    perform set_config('manor.command_id',s.id::text,true);
    perform set_config('manor.operation','create_attempt',true);
    perform set_config('manor.actor','user',true);
    perform set_config('manor.provenance',jsonb_build_object('submissionId',s.id,'language',s.language)::text,true);
    insert into public.leetcode_attempts(id,user_id,problem_id,date,solution) values(gen_random_uuid()::text,p_owner,s.problem_id,attempt_day,s.source_code);
   end if;
  end if;
  if s.status in ('completed','failed') then delete from manor_private.problem_execution_jobs where user_id=p_owner and submission_id=sid; end if;
  return manor_private.problem_submission_json(s);
 elsif p_action='editor_expired' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'owner',user_id,'sandboxName',sandbox_name)) from (select id,user_id,sandbox_name from manor_private.problem_editor_sessions where expires_at<=clock_timestamp() order by expires_at limit 4) expired),'[]'::jsonb);
 elsif p_action='editor_save' then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'problem-editors',0));
  if (select count(*) from manor_private.problem_editor_sessions where user_id=p_owner and expires_at>clock_timestamp())>=4 then raise exception 'Four editor sessions are already open. Close one before opening another'; end if;
  if not exists(select 1 from public.leetcode_problems where id=p_input->>'problemId' and (user_id is null or user_id=p_owner)) then raise exception 'Problem not found'; end if;
  insert into manor_private.problem_editor_sessions(user_id,id,problem_id,language,sandbox_name,expires_at) values(p_owner,(p_input->>'id')::uuid,p_input->>'problemId',p_input->>'language',p_input->>'sandboxName',(p_input->>'expiresAt')::timestamptz);
  return jsonb_build_object('id',p_input->>'id');
 elsif p_action='editor_read' then
  return (select jsonb_build_object('sandboxName',sandbox_name,'expiresAt',expires_at) from manor_private.problem_editor_sessions where user_id=p_owner and id=(p_input->>'id')::uuid);
 elsif p_action='editor_delete' then
  delete from manor_private.problem_editor_sessions where user_id=p_owner and id=(p_input->>'id')::uuid;
  return jsonb_build_object('deleted',true);
 else raise exception 'Unknown problem runner action: %',p_action;
 end if;
end $$;
revoke all on function public.manor_problem_runner(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manor_problem_runner(text,uuid,jsonb) to service_role;

-- The capability version moves with the shared catalog and custom-only problem tools.
create or replace function public.manor_workspace_query(p_query text,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 account public.profiles; local_today date; first_day date; last_day date;
 row_limit integer:=coalesce((p_input->>'limit')::integer,50);
 cursor_value text:=coalesce(p_input->>'cursor',''); rows_json jsonb; result jsonb;
 head bigint; supplied_cursor bigint; job manor_private.integration_jobs;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(false) then raise exception using errcode='42501',message='This agent is not authorized to read'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>10000 or row_limit not between 1 and 200 then raise exception using errcode='22023',message='Workspace queries require bounded object input and a limit from 1 to 200'; end if;
 select * into account from public.profiles where user_id=auth.uid();
 local_today:=(now() at time zone account.timezone)::date;
 if p_query in ('get_workspace_context','get_preferences') then
  result:=jsonb_build_object('name',account.name,'timezone',account.timezone,'revision',account.revision,'today',local_today,'onboarding_required',account.timezone is null);
  if p_query='get_preferences' then return result; end if;
  return result||jsonb_build_object('capability_version','2026-10-14','change_cursor',coalesce((select cursor from manor_private.workspace_change_heads where user_id=auth.uid()),0)::text,
   'access',jsonb_build_object('read',true,'write',auth.jwt()->>'client_id' is null or manor_private.mcp_allowed(true)),
   'restrictions',jsonb_build_object('calendar','read_only','live_browser_context','unavailable','unsaved_drafts','unavailable','changes_begin','feed_installation','note_interchange','block_json_only','bookmark_preview_refresh','unavailable'));
 elsif p_query='get_operation_status' then
  if p_input->>'command_id' is null then raise exception 'A command ID is required'; end if;
  select jsonb_build_object('command_id',command_id,'operation',operation,'committed_at',created_at,'status',case when response->>'purged'='true' then 'result_purged' else 'committed' end) into result
  from manor_private.command_receipts where user_id=auth.uid() and command_id=(p_input->>'command_id')::uuid;
  return coalesce(result,jsonb_build_object('command_id',p_input->>'command_id','status','not_recorded'));
 elsif p_query='get_changes_since' then
  if p_input->>'cursor' is null or p_input->>'cursor' !~ '^[0-9]+$' then raise exception 'A nonnegative account cursor is required'; end if;
  supplied_cursor:=(p_input->>'cursor')::bigint;
  select coalesce((select cursor from manor_private.workspace_change_heads where user_id=auth.uid()),0) into head;
  if supplied_cursor>head then raise exception 'Cursor is ahead of this account; start from its workspace context'; end if;
  select coalesce(jsonb_agg(to_jsonb(c)-'user_id' order by cursor),'[]') into rows_json from
   (select * from manor_private.workspace_changes where user_id=auth.uid() and cursor>supplied_cursor and cursor<=head order by cursor limit row_limit) c;
  return jsonb_build_object('items',rows_json,'next_cursor',coalesce(rows_json->-1->>'cursor',supplied_cursor::text),'head_cursor',head::text,'has_more',coalesce((rows_json->-1->>'cursor')::bigint,supplied_cursor)<head);
 elsif p_query='get_background_run' then
  if p_input->>'provider' is null or p_input->>'provider' not in ('google','x') or p_input->>'account_id' is null then raise exception 'Choose a Google or X account'; end if;
  select * into job from manor_private.integration_jobs where user_id=auth.uid() and provider=p_input->>'provider' and account_id=p_input->>'account_id';
  if not found then raise exception using errcode='P0002',message='Synchronization job is unavailable'; end if;
  return jsonb_build_object('provider',job.provider,'account_id',job.account_id,'scheduled_at',job.run_after,'leased_until',job.leased_until,'attempts',job.attempts,
   'status',case when job.leased_until>now() then 'running' when job.last_error is not null then 'failed' else 'scheduled' end,
   'retry_eligible',job.last_error is not null and (job.leased_until is null or job.leased_until<=now()) and exists(select 1 from manor_private.integration_credentials c where c.user_id=auth.uid() and c.provider=job.provider and c.account_id=job.account_id));
 elsif p_query='get_application_history' then
  if p_input->>'application_id' is null then raise exception 'An application ID is required'; end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(t.at,t.id)::text cursor,t.id,t.role_id application_id,t.from_stage,t.to_stage,t.at
   from public.job_stage_transitions t where t.user_id=auth.uid() and t.role_id=p_input->>'application_id'
    and (not p_input?'from' or t.at>=(p_input->>'from')::timestamptz) and (not p_input?'to' or t.at<(p_input->>'to')::timestamptz)
    and jsonb_build_array(t.at,t.id)::text>cursor_value order by cursor limit row_limit
  ) h;
 elsif p_query='list_trash' then
  if p_input?'module' and p_input->>'module' not in ('tasks','applications','notes') then raise exception 'Trash module must be tasks, applications, or notes'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(module,id)::text cursor,items.*,deleted_at+interval '7 days' purge_eligible_at,deleted_at>now()-interval '7 days' recoverable from (
    select 'tasks' module,id,title,revision,deleted_at,null::text parent_page_id,null::text trash_root_id from public.tasks where user_id=auth.uid() and deleted_at is not null
    union all select 'applications',id,company||' · '||role,revision,deleted_at,null::text,null::text from public.job_roles where user_id=auth.uid() and deleted_at is not null
    union all select 'notes',id,title,revision,deleted_at,parent_page_id,trash_root_id from public.note_pages where user_id=auth.uid() and status='trash'
   ) items where (not p_input?'module' or module=p_input->>'module') and jsonb_build_array(module,id)::text>cursor_value order by cursor limit row_limit
  ) t;
 elsif p_query='get_integration_status' then
  select coalesce(jsonb_agg(to_jsonb(c) order by cursor),'[]') into rows_json from (
   select jsonb_build_array(c.provider,c.account_id)::text cursor,c.provider,c.account_id,c.username,c.connected_at,j.run_after scheduled_at,j.leased_until,j.attempts,
    case when j.provider is null then 'not_scheduled' when j.leased_until>now() then 'running' when j.last_error is not null then 'failed' else 'scheduled' end status
   from manor_private.integration_credentials c left join manor_private.integration_jobs j using(user_id,provider,account_id)
   where c.user_id=auth.uid() and jsonb_build_array(c.provider,c.account_id)::text>cursor_value order by cursor limit row_limit
  ) c;
 else
  if local_today is null then raise exception 'Save an account timezone before querying dated records'; end if;
  if p_query in ('query_calendar_events','query_habit_history','get_metrics') then
   first_day:=(p_input->>'from')::date; last_day:=(p_input->>'to')::date;
   if first_day is null or last_day is null or last_day<first_day or last_day-first_day>365 then raise exception 'Choose an inclusive date range of 1 to 366 days'; end if;
  end if;
  if p_query='query_calendar_events' then
   select coalesce(jsonb_agg(to_jsonb(e) order by cursor),'[]') into rows_json from (
    select jsonb_build_array(e.account_id,e.calendar_id,e.id)::text cursor,e.id,e.account_id,e.calendar_id,e.title,e.starts_at,e.ends_at,e.start_date,e.end_date,e.all_day
    from public.calendar_events e join public.calendars c on c.user_id=e.user_id and c.account_id=e.account_id and c.id=e.calendar_id
    where e.user_id=auth.uid() and c.enabled and (not p_input?'account_id' or e.account_id=p_input->>'account_id') and (not p_input?'calendar_id' or e.calendar_id=p_input->>'calendar_id')
     and jsonb_build_array(e.account_id,e.calendar_id,e.id)::text>cursor_value
     and case when e.all_day then e.start_date<=last_day and e.end_date>first_day
      else e.starts_at<((last_day+1)::timestamp at time zone account.timezone) and e.ends_at>=(first_day::timestamp at time zone account.timezone) end
    order by cursor limit row_limit
   ) e;
  elsif p_query='query_habits' then
   first_day:=coalesce((p_input->>'date')::date,local_today);
   if first_day>local_today then raise exception 'Habit status cannot be queried for a future date'; end if;
   select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') into rows_json from (select * from (
    select h.id,h.name,h.kind,h.target_label,h.created_on,h.revision,h.position,
     coalesce((select l.status from public.habit_lifecycle l where l.user_id=auth.uid() and l.habit_id=h.id and l.date<=first_day order by l.date desc limit 1),'active') status
    from public.habits h where h.user_id=auth.uid() and h.created_on<=first_day and h.id>cursor_value
   ) matched where (not p_input?'status' or matched.status=p_input->>'status') order by id limit row_limit) h;
  elsif p_query='query_habit_history' then
   select coalesce(jsonb_agg(to_jsonb(h) order by cursor),'[]') into rows_json from (
    select jsonb_build_array(d.tracked_date::date,h.id)::text cursor,h.id habit_id,d.tracked_date::date as date,e.value,coalesce(e.revision,0) entry_revision,(e.value is null) missing
    from public.habits h cross join generate_series(first_day::timestamp,least(last_day,local_today)::timestamp,interval '1 day') d(tracked_date)
    left join public.habit_entries e on e.user_id=h.user_id and e.habit_id=h.id and e.date=d.tracked_date::date
    where h.user_id=auth.uid() and h.created_on<=d.tracked_date::date and (not p_input?'habit_id' or h.id=p_input->>'habit_id')
     and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date::date order by l.date desc limit 1),'active')='active'
     and jsonb_build_array(d.tracked_date::date,h.id)::text>cursor_value order by cursor limit row_limit
   ) h;
  elsif p_query='get_metrics' then
   if p_input->>'group_by' is null or p_input->>'group_by' not in ('total','day') then raise exception 'Metric grouping must be total or day'; end if;
   with days as (select generate_series(first_day::timestamp,least(last_day,local_today)::timestamp,interval '1 day')::date as tracked_date), daily as (
    select d.tracked_date,
     (select count(*) from public.tasks t where t.user_id=auth.uid() and t.deleted_at is null and t.completed_at>=(d.tracked_date::timestamp at time zone account.timezone) and t.completed_at<((d.tracked_date+1)::timestamp at time zone account.timezone)) tasks_completed,
     (select count(*) from public.habits h where h.user_id=auth.uid() and h.created_on<=d.tracked_date and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date order by l.date desc limit 1),'active')='active') habit_eligible_days,
     (select count(*) from public.habits h join public.habit_entries e on e.user_id=h.user_id and e.habit_id=h.id and e.date=d.tracked_date and e.value=100 where h.user_id=auth.uid() and h.created_on<=d.tracked_date and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=d.tracked_date order by l.date desc limit 1),'active')='active') habits_completed,
     m.mood,m.focus from days d left join public.mood_focus_entries m on m.user_id=auth.uid() and m.date=d.tracked_date
   )
   select jsonb_build_object('from',first_day,'to',last_day,'timezone',account.timezone,'observed_days',count(*),
    'tasks_completed',coalesce(sum(tasks_completed),0),'habit_eligible_days',coalesce(sum(habit_eligible_days),0),'habits_completed',coalesce(sum(habits_completed),0),
    'habit_completion_rate',sum(habits_completed)::numeric/nullif(sum(habit_eligible_days),0),
    'mood_samples',count(mood),'mood_missing',count(*)-count(mood),'focus_samples',count(focus),'focus_missing',count(*)-count(focus),
    'mood_distribution',(select coalesce(jsonb_object_agg(mood,n),'{}') from (select mood,count(*) n from daily where mood is not null group by mood) m),
    'focus_distribution',(select coalesce(jsonb_object_agg(focus,n),'{}') from (select focus,count(*) n from daily where focus is not null group by focus) f),
    'days',case when p_input->>'group_by'='day' then coalesce(jsonb_agg(to_jsonb(daily) order by tracked_date),'[]') else null end,
    'membership','Task counts use retained non-trashed records with completed_at in each local day; reopening or purge removes that record from these counts. Habit denominator includes active days since creation through today. Resting is a Focus sample; future days are excluded.') into result from daily;
   return result;
  elsif p_query='get_day_overview' then
   first_day:=(p_input->>'date')::date;
   if first_day is null then raise exception 'Choose a date'; end if;
   select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows_json from (select id,title,status,due,due_time,context_id,priority,revision from public.tasks where user_id=auth.uid() and due=first_day and deleted_at is null and skipped_at is null and superseded_at is null order by id limit row_limit) t;
   result:=jsonb_build_object('date',first_day,'timezone',account.timezone,'tasks',jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then rows_json->-1->>'id' end));
   select coalesce(jsonb_agg(to_jsonb(s)-'user_id' order by id),'[]') into rows_json from (select * from public.scratch_blocks where user_id=auth.uid() and date=first_day and expires_at>now() order by id limit row_limit) s;
   result:=result||jsonb_build_object('scratch_blocks',jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then rows_json->-1->>'id' end),
    'calendar',public.manor_workspace_query('query_calendar_events',jsonb_build_object('from',first_day,'to',first_day,'limit',row_limit)),
    'daily_record',(select to_jsonb(m)-'user_id' from public.mood_focus_entries m where user_id=auth.uid() and date=first_day));
   if first_day<=local_today then result:=result||jsonb_build_object('metrics',public.manor_workspace_query('get_metrics',jsonb_build_object('from',first_day,'to',first_day,'group_by','total'))); end if;
   return result;
  else raise exception using errcode='22023',message='Unsupported workspace query: '||p_query;
  end if;
 end if;
 return jsonb_build_object('items',rows_json,'next_cursor',case when jsonb_array_length(rows_json)=row_limit then coalesce(rows_json->-1->>'cursor',rows_json->-1->>'id') end);
end $$;

do $$
declare problem text; account uuid;
begin
 select c.user_id into account from catalog_counts c where c.attempts<>(select count(*) from public.leetcode_attempts a where a.user_id=c.user_id)
  or c.notes<>(select count(*) from public.leetcode_notes n where n.user_id=c.user_id)
  or c.submissions<>(select count(*) from public.problem_submissions s where s.user_id=c.user_id)
  or c.drafts<>(select count(*) from public.problem_code_drafts d where d.user_id=c.user_id)
  or c.views<>(select count(*) from public.saved_problem_views v where v.user_id=c.user_id)
  or c.practice<>(select count(*) from public.problem_practice pp where pp.user_id=c.user_id) limit 1;
 if account is not null then raise exception 'Catalog conversion changed the practice records of account %',account; end if;
 select c.id into problem from catalog_curriculum c where not exists(select 1 from public.leetcode_problems p where p.id=c.id and p.user_id is null and p.curriculum_order=c.curriculum_order) order by c.id limit 1;
 if problem is not null then raise exception 'Catalog conversion lost curriculum problem % or its position',problem; end if;
 if (select contents from catalog_totals)<>(select count(*) from public.problem_content_versions) or (select testsets from catalog_totals)<>(select count(*) from manor_private.problem_testsets) then raise exception 'Catalog conversion changed the number of statement versions or testsets'; end if;
 if exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='seed_manor_curriculum') then raise exception 'The curriculum seed trigger is still installed'; end if;
end $$;

revoke create on schema manor_private,public from manor_commands;
commit;
