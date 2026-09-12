create table public.file_objects (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(purpose in ('note','resume','avatar','capture')),
 parent_id text, label text check(label is null or length(label) between 1 and 120), name text not null check(length(name) between 1 and 255),
 mime_type text not null, size bigint not null check(size between 1 and 26214400),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,
 status text not null check(status in ('allocated','ready','purging')),
 created_at timestamptz not null default clock_timestamp(), finalized_at timestamptz
);
alter table public.file_objects enable row level security;
grant select on public.file_objects to authenticated;
grant select,insert,update,delete on public.file_objects to manor_commands;
grant all on public.file_objects to service_role;
create policy files_read on public.file_objects for select to authenticated using(user_id=(select auth.uid()));
create policy files_command on public.file_objects to manor_commands using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit) values('manor-files','manor-files',false,26214400);
create policy manor_file_upload on storage.objects for insert to authenticated with check(
 bucket_id='manor-files' and exists(select 1 from public.file_objects f where f.user_id=(select auth.uid()) and f.storage_path=storage.objects.name and f.status='allocated')
);
create policy manor_file_download on storage.objects for select to authenticated using(
 bucket_id='manor-files' and exists(select 1 from public.file_objects f where f.user_id=(select auth.uid()) and f.storage_path=storage.objects.name and f.status='ready'
 and (f.purpose<>'note' or exists(select 1 from public.note_pages n where n.id=f.parent_id and n.user_id=f.user_id and n.status<>'trash')))
);

create function manor_private.files_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare f public.file_objects; existing public.file_objects; uid uuid:=auth.uid();
begin
 if op='allocate_file' then
  if p->>'purpose'='note' and not exists(select 1 from public.note_pages where user_id=uid and id=p->>'parent_id' and status<>'trash') then raise exception 'Select an available note before attaching a file'; end if;
  if p->>'purpose'='capture' and not exists(select 1 from public.kb_entries where user_id=uid and id=(p->>'parent_id')::uuid) then raise exception 'Select an available capture before attaching a file'; end if;
  if p->>'purpose'='resume' and p->>'mime_type'<>'application/pdf' then raise exception 'Resumes must be PDF files'; end if;
  if p->>'purpose'='avatar' and p->>'mime_type' not in ('image/png','image/jpeg','image/webp') then raise exception 'Profile pictures must be PNG, JPEG, or WebP'; end if;
  if p->>'purpose'='avatar' and (p->>'size')::bigint>5242880 then raise exception 'Profile pictures must be 5 MB or smaller'; end if;
  select * into existing from public.file_objects where user_id=uid and id=(p->>'id')::uuid;
  if found then raise exception 'File identity already exists; retry with its original command ID'; end if;
  insert into public.file_objects(id,user_id,purpose,parent_id,label,name,mime_type,size,sha256,storage_path,status)
  values((p->>'id')::uuid,uid,p->>'purpose',p->>'parent_id',p->>'label',p->>'name',p->>'mime_type',(p->>'size')::bigint,p->>'sha256',uid::text||'/'||(p->>'id'),'allocated') returning * into f;
  return to_jsonb(f);
 elsif op='remove_resume' then
  if exists(select 1 from public.job_roles where user_id=uid and resume_id=(p->>'id')::uuid) then raise exception 'This resume is attached to an application. Keep the recorded version or update that application first.'; end if;
  delete from public.resumes where user_id=uid and id=(p->>'id')::uuid;
  update public.file_objects set status='purging' where user_id=uid and id=(p->>'id')::uuid and purpose='resume' returning * into f;
  if f.id is null then raise exception 'Resume file was not found'; end if;
  return to_jsonb(f);
 else raise exception 'Unsupported file operation'; end if;
end $$;
grant create on schema manor_private to manor_commands;
alter function manor_private.files_command(text,jsonb) owner to manor_commands;
revoke create on schema manor_private from manor_commands;
revoke all on function manor_private.files_command(text,jsonb) from public;

-- Only the verifier may finish an upload; browsers cannot attest their own bytes.
create function public.manor_finalize_file(p_owner uuid,p_id uuid,p_sha256 text,p_size bigint,p_mime_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.file_objects;
begin
 select * into f from public.file_objects where user_id=p_owner and id=p_id for update;
 if f.id is null then raise exception 'Upload intent not found'; end if;
 if f.sha256<>p_sha256 or f.size<>p_size or f.mime_type<>p_mime_type then raise exception 'Uploaded bytes do not match the allocated file'; end if;
 if f.status='ready' then return to_jsonb(f); end if;
 if f.status<>'allocated' then raise exception 'This file cannot be finalized'; end if;
 perform set_config('manor.command_id',f.id::text,true);
 perform set_config('manor.operation','finalize_file',true);
 if f.purpose='note' then
  if not exists(select 1 from public.note_pages where user_id=p_owner and id=f.parent_id and status<>'trash') then raise exception 'The parent note is no longer available'; end if;
  insert into public.note_attachments(id,user_id,note_id,name,mime_type,size,storage_path) values(f.id,p_owner,f.parent_id,f.name,f.mime_type,f.size,f.storage_path);
 elsif f.purpose='resume' then
  insert into public.resumes(id,user_id,label,file_name,storage_path,byte_size) values(f.id,p_owner,coalesce(f.label,f.name),f.name,f.storage_path,f.size);
 elsif f.purpose='avatar' then
  update public.profiles set settings=jsonb_set(settings,'{avatar_file_id}',to_jsonb(f.id::text)),revision=revision+1 where user_id=p_owner;
 elsif f.purpose='capture' then
  update public.kb_entries set screenshot_path=f.storage_path,revision=revision+1 where user_id=p_owner and id=f.parent_id::uuid;
 end if;
 update public.file_objects set status='ready',finalized_at=clock_timestamp() where id=f.id returning * into f;
 return to_jsonb(f);
end $$;
revoke all on function public.manor_finalize_file(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.manor_finalize_file(uuid,uuid,text,bigint,text) to service_role;
