create table public.record_links (
 id text primary key check(length(id) between 1 and 200), user_id uuid not null references auth.users(id) on delete cascade,
 source_module text not null check(source_module in ('tasks','notes','applications','knowledge')), source_id text not null,
 target_module text not null check(target_module in ('tasks','notes','applications','knowledge')), target_id text not null,
 revision bigint not null default 1, created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
 check(source_module<>target_module or source_id<>target_id)
);
create unique index record_links_pair on public.record_links(user_id,least(source_module||':'||source_id,target_module||':'||target_id),greatest(source_module||':'||source_id,target_module||':'||target_id)) where deleted_at is null;
create index record_links_source on public.record_links(user_id,source_module,source_id);
create index record_links_target on public.record_links(user_id,target_module,target_id);
alter table public.record_links enable row level security;
grant select,insert,update,delete on public.record_links to manor_commands;
grant all on public.record_links to service_role;
create policy links_command on public.record_links to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
create trigger manor_history after insert or update on public.record_links for each row execute function manor_private.record_change();
create trigger manor_workspace_changes after insert or update or delete on public.record_links for each row execute function manor_private.record_workspace_change();

create function manor_private.related_record(module text,rid text) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; source_table text;
begin
 source_table:=case module when 'tasks' then 'tasks' when 'notes' then 'note_pages' when 'applications' then 'job_roles' when 'knowledge' then 'kb_entries' else null end;
 if source_table is null then raise exception 'Supported relationship modules: tasks, notes, applications, knowledge'; end if;
 if exists(select 1 from manor_private.purge_tombstones where user_id=auth.uid() and object_type=source_table and object_id=rid) then return null; end if;
 if module='tasks' then
  select jsonb_build_object('module',module,'id',id,'revision',revision,'title',title,'status',status,'due',due) into result from public.tasks where user_id=auth.uid() and id=rid and deleted_at is null;
 elsif module='notes' then
  select jsonb_build_object('module',module,'id',id,'revision',revision,'title',title,'status',status) into result from public.note_pages where user_id=auth.uid() and id=rid and status<>'trash';
 elsif module='applications' then
  select jsonb_build_object('module',module,'id',id,'revision',revision,'company',company,'role',role,'stage',stage) into result from public.job_roles where user_id=auth.uid() and id=rid and deleted_at is null;
 else
  select jsonb_build_object('module',module,'id',id,'revision',revision,'title',title,'url',url) into result from public.kb_entries where user_id=auth.uid() and id::text=rid and deleted_at is null;
 end if;
 return result;
end $$;

create function manor_private.related_tool_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare link public.record_links; source jsonb; target jsonb; result jsonb;
begin
 select * into link from public.record_links where user_id=auth.uid() and id=p->>'id' for update;
 perform manor_private.require_revision(link.revision,(p->>'expected_revision')::bigint,to_jsonb(link));
 if op='link_records' then
  if link.id is not null then raise exception 'Relationship ID already exists; use a new ID'; end if;
  source:=manor_private.related_record(p->>'source_module',p->>'source_id');
  target:=manor_private.related_record(p->>'target_module',p->>'target_id');
  if source is null or target is null then raise exception 'Both relationship endpoints must be available records owned by this account'; end if;
  perform manor_private.require_revision((source->>'revision')::bigint,(p->>'source_expected_revision')::bigint,source);
  perform manor_private.require_revision((target->>'revision')::bigint,(p->>'target_expected_revision')::bigint,target);
  if p->>'source_module'=p->>'target_module' and p->>'source_id'=p->>'target_id' then raise exception 'A record cannot link to itself'; end if;
  if exists(select 1 from public.record_links where user_id=auth.uid() and deleted_at is null and
   ((source_module=p->>'source_module' and source_id=p->>'source_id' and target_module=p->>'target_module' and target_id=p->>'target_id')
    or (source_module=p->>'target_module' and source_id=p->>'target_id' and target_module=p->>'source_module' and target_id=p->>'source_id'))) then raise exception 'These records are already linked'; end if;
  insert into public.record_links(id,user_id,source_module,source_id,target_module,target_id)
   values(p->>'id',auth.uid(),p->>'source_module',p->>'source_id',p->>'target_module',p->>'target_id') returning to_jsonb(record_links.*) into result;
 elsif op='unlink_records' then
  if link.id is null or link.deleted_at is not null then raise exception 'Relationship is unavailable'; end if;
  update public.record_links set deleted_at=clock_timestamp(),revision=revision+1 where user_id=auth.uid() and id=link.id returning to_jsonb(record_links.*) into result;
 else raise exception 'Unsupported relationship operation: %',op;
 end if;
 return result;
end $$;

create function public.manor_related_query(p_query text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare root jsonb; result jsonb; take integer:=(p_input->>'limit')::integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_query='read_knowledge' then
  root:=manor_private.related_record('knowledge',p_input->>'id');
  if root is null then raise exception 'Knowledge record is unavailable'; end if;
  select to_jsonb(k.*) into result from public.kb_entries k where user_id=auth.uid() and id::text=p_input->>'id' and deleted_at is null;
  return result;
 end if;
 if p_query<>'get_related_records' then raise exception 'Unsupported relationship query: %',p_query; end if;
 if take is null or take not between 1 and 200 then raise exception 'Supply limit between 1 and 200'; end if;
 root:=manor_private.related_record(p_input->>'module',p_input->>'id');
 if root is null then raise exception 'Relationship source is unavailable'; end if;
 with candidates as (
  select l.id,l.revision,manor_private.related_record(case when l.source_module=p_input->>'module' and l.source_id=p_input->>'id' then l.target_module else l.source_module end,
   case when l.source_module=p_input->>'module' and l.source_id=p_input->>'id' then l.target_id else l.source_id end) record
  from public.record_links l where l.user_id=auth.uid() and l.deleted_at is null
   and ((l.source_module=p_input->>'module' and l.source_id=p_input->>'id') or (l.target_module=p_input->>'module' and l.target_id=p_input->>'id'))
   and (p_input->>'cursor' is null or l.id>p_input->>'cursor')),
 matches as (select * from candidates where record is not null order by id limit take+1), page as (select * from matches order by id limit take)
 select jsonb_build_object('source',root,'relationship_kind','explicit','items',coalesce((select jsonb_agg(to_jsonb(page) order by id) from page),'[]'),
  'next_cursor',case when (select count(*) from matches)>take then (select max(id) from page) end) into result;
 return result;
end $$;

create function manor_private.purge_record_links() returns trigger language plpgsql security definer set search_path='' as $$
declare module text; owner_id uuid; endpoint_id text; source_table text;
begin
 if tg_op='DELETE' then owner_id:=old.user_id; endpoint_id:=old.id::text; source_table:=tg_table_name; else owner_id:=new.user_id; endpoint_id:=new.object_id; source_table:=new.object_type; end if;
 module:=case source_table when 'tasks' then 'tasks' when 'note_pages' then 'notes' when 'job_roles' then 'applications' when 'kb_entries' then 'knowledge' else null end;
 if module is not null then
  with removed as (delete from public.record_links where user_id=owner_id and ((source_module=module and source_id=endpoint_id) or (target_module=module and target_id=endpoint_id)) returning id)
  update public.action_events set changes='{}',provenance=null,object_id=null,scrubbed_at=clock_timestamp() where user_id=owner_id and object_type='record_links' and object_id in (select id from removed);
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true)
   where user_id=owner_id and operation in ('link_records','unlink_records') and response::text like '%'||to_jsonb(endpoint_id)::text||'%';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger purge_record_links after insert on manor_private.purge_tombstones for each row execute function manor_private.purge_record_links();
create trigger purge_record_links after delete on public.tasks for each row execute function manor_private.purge_record_links();
create trigger purge_record_links after delete on public.note_pages for each row execute function manor_private.purge_record_links();
create trigger purge_record_links after delete on public.job_roles for each row execute function manor_private.purge_record_links();
create trigger purge_record_links after delete on public.kb_entries for each row execute function manor_private.purge_record_links();
grant create on schema manor_private,public to manor_commands;
alter function manor_private.related_tool_command(text,jsonb) owner to manor_commands;
alter function public.manor_related_query(text,jsonb) owner to manor_commands;
revoke create on schema manor_private,public from manor_commands;
revoke all on function manor_private.related_record(text,text),manor_private.related_tool_command(text,jsonb),manor_private.purge_record_links(),public.manor_related_query(text,jsonb) from public,anon,authenticated;
grant execute on function manor_private.related_record(text,text) to manor_commands;
grant execute on function public.manor_related_query(text,jsonb) to authenticated;
