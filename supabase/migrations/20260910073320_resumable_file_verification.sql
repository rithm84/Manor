-- Hash state can contain source bytes. Never expose it through browser/MCP grants.
create table manor_private.file_verification (
 file_id uuid primary key references public.file_objects(id) on delete cascade,
 verified_bytes bigint not null check(verified_bytes between 1 and 1000000000),
 hash_state text not null check(length(hash_state) between 1 and 4096),
 object_etag text not null check(length(object_etag) between 1 and 255)
);
revoke all on manor_private.file_verification from public,anon,authenticated,service_role;

create function public.manor_file_verification_state(p_owner uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.file_objects; v manor_private.file_verification;
begin
 select * into f from public.file_objects where id=p_id and user_id=p_owner;
 if f.id is null or f.status<>'allocated' then raise exception 'Upload intent is not available for verification'; end if;
 select * into v from manor_private.file_verification where file_id=p_id;
 return jsonb_build_object('verified_bytes',coalesce(v.verified_bytes,0),'hash_state',v.hash_state,'object_etag',v.object_etag);
end $$;

create function public.manor_checkpoint_file_verification(p_owner uuid,p_id uuid,p_offset bigint,p_next_offset bigint,p_hash_state text,p_object_etag text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.file_objects; v manor_private.file_verification; result jsonb;
begin
 select * into f from public.file_objects where id=p_id and user_id=p_owner for update;
 if f.id is null then raise exception 'Upload intent not found'; end if;
 if f.status='ready' then return to_jsonb(f); end if;
 if f.status<>'allocated' then raise exception 'Upload is no longer available'; end if;
 select * into v from manor_private.file_verification where file_id=p_id;
 if coalesce(v.verified_bytes,0)<>p_offset then
  return jsonb_build_object('id',p_id,'status','verifying','verified_bytes',coalesce(v.verified_bytes,0),'total_bytes',f.size);
 end if;
 if p_next_offset<=p_offset or p_next_offset>least(f.size,p_offset+33554432) or p_object_etag is null or (v.object_etag is not null and v.object_etag<>p_object_etag) then raise exception 'File verification checkpoint does not match the immutable upload'; end if;
 if p_next_offset=f.size then
  if p_sha256 is null or p_sha256<>f.sha256 then raise exception 'Uploaded file checksum differs from the upload intent'; end if;
  result:=public.manor_finalize_file(p_owner,p_id,p_sha256,f.size,f.mime_type);
  delete from manor_private.file_verification where file_id=p_id;
  return result;
 end if;
 insert into manor_private.file_verification(file_id,verified_bytes,hash_state,object_etag)
 values(p_id,p_next_offset,p_hash_state,p_object_etag)
 on conflict(file_id) do update set verified_bytes=excluded.verified_bytes,hash_state=excluded.hash_state;
 return jsonb_build_object('id',p_id,'status','verifying','verified_bytes',p_next_offset,'total_bytes',f.size);
end $$;
revoke all on function public.manor_file_verification_state(uuid,uuid),public.manor_checkpoint_file_verification(uuid,uuid,bigint,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.manor_file_verification_state(uuid,uuid),public.manor_checkpoint_file_verification(uuid,uuid,bigint,bigint,text,text,text) to service_role;

create function manor_private.clear_file_verification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'allocated' then delete from manor_private.file_verification where file_id=new.id; end if;
 return new;
end $$;
revoke all on function manor_private.clear_file_verification() from public;
create trigger clear_file_verification after update of status on public.file_objects for each row execute function manor_private.clear_file_verification();
