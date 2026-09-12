-- Staging-only synthetic verification checkpoints; no object bytes required.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('33333333-3333-4333-8333-333333333333','authenticated','authenticated','manor-verifier@example.invalid','{"provider":"google"}','{}',now(),now());
insert into public.file_objects(id,user_id,purpose,name,mime_type,size,sha256,storage_path,status)
values('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','resume','synthetic.pdf','application/pdf',100000000,repeat('0',64),'33333333-3333-4333-8333-333333333333/verifier','allocated');
do $$declare r jsonb;
begin
 if has_function_privilege('authenticated','public.manor_file_verification_state(uuid,uuid)','execute') or has_table_privilege('authenticated','manor_private.file_verification','select') then raise exception 'Private hash state is exposed'; end if;
 r:=public.manor_checkpoint_file_verification('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',0,33554432,'private-state','etag-a',null);
 if (r->>'verified_bytes')::bigint<>33554432 then raise exception 'Checkpoint failed'; end if;
 r:=public.manor_checkpoint_file_verification('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',0,33554432,'stale-state','etag-a',null);
 if (select hash_state from manor_private.file_verification where file_id='44444444-4444-4444-8444-444444444444')<>'private-state' then raise exception 'Stale CAS overwrote checkpoint'; end if;
 begin
  perform public.manor_checkpoint_file_verification('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',33554432,67108864,'next-state','changed-etag',null);
  raise exception using errcode='XX001',message='Changed object accepted';
 exception when raise_exception then null; end;
 begin
  perform public.manor_file_verification_state('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444');
  raise exception using errcode='XX001',message='Different owner accepted';
 exception when raise_exception then null; end;
 update public.file_objects set status='purging' where id='44444444-4444-4444-8444-444444444444';
 if exists(select 1 from manor_private.file_verification where file_id='44444444-4444-4444-8444-444444444444') then raise exception 'Purging retained partial content'; end if;
end $$;
rollback;
