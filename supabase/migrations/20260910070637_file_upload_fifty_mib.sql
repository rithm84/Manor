-- Match the existing project-wide Storage ceiling; no plan or global limit change.
alter table public.file_objects drop constraint file_objects_size_check;
alter table public.file_objects add constraint file_objects_size_check check(size between 1 and 52428800);
update storage.buckets set file_size_limit=52428800 where id='manor-files';
create or replace function manor_private.files_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare f public.file_objects; existing public.file_objects; uid uuid:=auth.uid();
begin
 if op='allocate_file' then
  if p->>'size' is null or (p->>'size')::bigint<1 then raise exception using errcode='PT400',message='This file is empty or has an invalid size. Choose a file with content.',detail='file_size_invalid'; end if;
  if (p->>'size')::bigint>52428800 then raise exception using errcode='PT413',message='Choose a file no larger than 50 MiB.',detail='file_too_large'; end if;
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
