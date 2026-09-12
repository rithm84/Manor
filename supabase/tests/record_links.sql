begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('acd593d8-4d85-4a53-8062-686458c465f7','authenticated','authenticated','record-links@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"acd593d8-4d85-4a53-8062-686458c465f7","role":"authenticated"}',true);
do $$
declare command_id uuid:=gen_random_uuid(); result jsonb;
begin
 perform public.manor_command(gen_random_uuid(),'create_note','{"id":"link-note-a","expected_revision":0,"title":"A","folder_id":null,"parent_page_id":null,"content_json":[]}');
 perform public.manor_command(gen_random_uuid(),'create_note','{"id":"link-note-b","expected_revision":0,"title":"B","folder_id":null,"parent_page_id":null,"content_json":[]}');
 perform public.manor_command(command_id,'link_records','{"id":"link-ab","expected_revision":0,"source_module":"notes","source_id":"link-note-a","source_expected_revision":1,"target_module":"notes","target_id":"link-note-b","target_expected_revision":1}');
 perform public.manor_command(command_id,'link_records','{"id":"link-ab","expected_revision":0,"source_module":"notes","source_id":"link-note-a","source_expected_revision":1,"target_module":"notes","target_id":"link-note-b","target_expected_revision":1}');
 result:=public.manor_related_query('get_related_records','{"module":"notes","id":"link-note-b","limit":20}');
 if jsonb_array_length(result->'items')<>1 or result->'items'->0->'record'->>'id'<>'link-note-a' then raise exception 'Reverse relationship retrieval or command retry failed'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'link_records','{"id":"link-ba","expected_revision":0,"source_module":"notes","source_id":"link-note-b","source_expected_revision":1,"target_module":"notes","target_id":"link-note-a","target_expected_revision":1}');
  raise exception 'Reverse duplicate link was accepted';
 exception when raise_exception then if sqlerrm<>'These records are already linked' then raise; end if;
 end;
 perform public.manor_command(gen_random_uuid(),'update_note','{"id":"link-note-b","expected_revision":1,"title":"Current B"}');
 result:=public.manor_related_query('get_related_records','{"module":"notes","id":"link-note-a","limit":20}');
 if result->'items'->0->'record'->>'title'<>'Current B' or (result->'items'->0->'record'->>'revision')::int<>2 then raise exception 'Relationship returned stale metadata'; end if;
 perform public.manor_command(gen_random_uuid(),'unlink_records','{"id":"link-ab","expected_revision":1}');
 if jsonb_array_length(public.manor_related_query('get_related_records','{"module":"notes","id":"link-note-a","limit":20}')->'items')<>0 then raise exception 'Unlinked relationship remained visible'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'link_records','{"id":"link-new","expected_revision":0,"source_module":"notes","source_id":"link-note-a","source_expected_revision":1,"target_module":"notes","target_id":"link-note-b","target_expected_revision":1}');
  raise exception 'Stale endpoint was accepted';
 exception when sqlstate 'PT409' then null;
 end;
 perform public.manor_command(gen_random_uuid(),'link_records','{"id":"link-new","expected_revision":0,"source_module":"notes","source_id":"link-note-a","source_expected_revision":1,"target_module":"notes","target_id":"link-note-b","target_expected_revision":2}');
 perform public.manor_command(gen_random_uuid(),'trash_note','{"id":"link-note-b","expected_revision":2}');
 if jsonb_array_length(public.manor_related_query('get_related_records','{"module":"notes","id":"link-note-a","limit":20}')->'items')<>0 then raise exception 'Trashed endpoint leaked through links'; end if;
end $$;
reset role;
insert into manor_private.purge_tombstones(user_id,object_type,object_id) values('acd593d8-4d85-4a53-8062-686458c465f7','note_pages','link-note-b');
do $$
begin
 if exists(select 1 from public.record_links where user_id='acd593d8-4d85-4a53-8062-686458c465f7') then raise exception 'Purge did not remove endpoint links'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5f32e836-6518-4b69-af0d-44572cf5c60b","role":"authenticated"}',true);
do $$
begin
 begin
  perform public.manor_related_query('get_related_records','{"module":"notes","id":"link-note-a","limit":20}');
  raise exception 'Foreign endpoint was readable';
 exception when raise_exception then if sqlerrm<>'Relationship source is unavailable' then raise; end if;
 end;
end $$;
rollback;
