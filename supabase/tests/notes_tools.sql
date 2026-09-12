-- Real database integration with synthetic records; no data survives rollback.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('d33cc330-556d-44d7-ad74-f2499f10440b','authenticated','authenticated','notes-tool-test@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d33cc330-556d-44d7-ad74-f2499f10440b","role":"authenticated"}',true);
do $$
declare result jsonb; copy_id text; command_id uuid:=gen_random_uuid(); before_content jsonb;
begin
 perform public.manor_command(gen_random_uuid(),'create_note_folder','{"id":"nt-folder","expected_revision":0,"name":"Notes test","parent_folder_id":null}');
 perform public.manor_command(gen_random_uuid(),'import_note','{"id":"nt-source","expected_revision":0,"format":"block_json","title":"Source","folder_id":"nt-folder","parent_page_id":null,"content_json":[{"id":"nt-block","type":"paragraph","content":[{"type":"text","text":"Needle","styles":{"bold":true}}],"children":[{"id":"nt-child-block","type":"paragraph","content":[{"type":"text","text":"Nested needle","styles":{}}],"children":[]}]}]}');
 perform public.manor_command(gen_random_uuid(),'create_note','{"id":"nt-child","expected_revision":0,"title":"Child","parent_page_id":"nt-source","folder_id":null,"content_json":[]}');
 result:=public.manor_notes_tool_query('find_in_note','{"id":"nt-source","search":"NEEDLE","limit":1}');
 if jsonb_array_length(result->'items')<>1 or result->>'next_cursor' is null then raise exception 'Find pagination failed'; end if;
 result:=public.manor_notes_tool_query('find_in_note',jsonb_build_object('id','nt-source','search','needle','limit',1,'cursor',result->>'next_cursor'));
 if jsonb_array_length(result->'items')<>1 or result->>'next_cursor' is not null then raise exception 'Find continuation failed'; end if;
 before_content:=public.manor_notes_tool_query('export_note','{"id":"nt-source","format":"block_json"}')->'content_json';
 perform public.manor_command(command_id,'duplicate_note','{"id":"nt-source","expected_revision":1,"new_id":"nt-copy","title":"Copy","folder_id":null,"parent_page_id":null}');
 perform public.manor_command(command_id,'duplicate_note','{"id":"nt-source","expected_revision":1,"new_id":"nt-copy","title":"Copy","folder_id":null,"parent_page_id":null}');
 if (select count(*) from public.note_pages where parent_page_id='nt-copy')<>1 then raise exception 'Recursive duplication or idempotency failed'; end if;
 result:=public.manor_notes_tool_query('export_note','{"id":"nt-copy","format":"block_json"}');
 if result->'content_json'->0->>'id'='nt-block' or result->'content_json'->0->'children'->0->>'id'='nt-child-block' then raise exception 'Copied block IDs were reused'; end if;
 if result->'content_json'->0->'content' is distinct from before_content->0->'content' then raise exception 'Native formatting was lost'; end if;
 perform public.manor_command(gen_random_uuid(),'duplicate_note_blocks','{"id":"nt-source","expected_revision":1,"target_note_id":"nt-copy","target_expected_revision":1,"block_ids":["nt-child-block"]}');
 if jsonb_array_length(public.manor_notes_tool_query('export_note','{"id":"nt-copy","format":"block_json"}')->'content_json')<>2 then raise exception 'Block duplication failed'; end if;
 if public.manor_notes_tool_query('export_note','{"id":"nt-source","format":"block_json"}')->'content_json' is distinct from before_content then raise exception 'Duplication modified the source'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'remove_empty_note_folder','{"id":"nt-folder","expected_revision":1}');
  raise exception 'Nonempty folder was removed';
 exception when raise_exception then
  if sqlerrm<>'Folder is not empty; move its notes (including Trash) and child folders before removing it' then raise; end if;
 end;
 begin
  perform public.manor_notes_tool_query('export_note','{"id":"nt-source","format":"markdown"}');
  raise exception 'Unsupported format was accepted';
 exception when raise_exception then
  if sqlerrm<>'Supported export format: block_json' then raise; end if;
 end;
 begin
  perform public.manor_command(gen_random_uuid(),'edit_note_media','{"id":"nt-source","expected_revision":1,"edits":[{"kind":"append","block":{"id":"bad-media","type":"image","props":{"url":"manor-attachment://d33cc330-556d-44d7-ad74-f2499f10440b"}}}]}');
  raise exception 'Unknown file was accepted';
 exception when raise_exception then
  if sqlerrm not like 'Attachment % must be an owned, ready file belonging to an available note' then raise; end if;
 end;
 perform public.manor_command(gen_random_uuid(),'trash_note','{"id":"nt-source","expected_revision":1}');
 begin
  perform public.manor_notes_tool_query('export_note','{"id":"nt-source","format":"block_json"}');
  raise exception 'Trashed note was exported';
 exception when raise_exception then if sqlerrm<>'Note is unavailable' then raise; end if;
 end;
end $$;
reset role;
-- Immutable file references survive the original parent's purge transition.
insert into public.file_objects(id,user_id,purpose,parent_id,name,mime_type,size,sha256,storage_path,status)
values('69dcb6ec-65d2-4d0d-8b44-c5a1e68c4bed','d33cc330-556d-44d7-ad74-f2499f10440b','note','nt-source','Shared','image/png',1,repeat('a',64),'synthetic-notes-tools/shared','ready');
set local role authenticated;
do $$
begin
 perform public.manor_command(gen_random_uuid(),'update_note','{"id":"nt-copy","expected_revision":2,"content_json":[{"id":"shared-image","type":"image","props":{"url":"manor-attachment://69dcb6ec-65d2-4d0d-8b44-c5a1e68c4bed"}}]}');
end $$;
reset role;
update public.file_objects set status='purging',name='Deleted file' where id='69dcb6ec-65d2-4d0d-8b44-c5a1e68c4bed';
do $$
begin
 if not exists(select 1 from public.file_objects where id='69dcb6ec-65d2-4d0d-8b44-c5a1e68c4bed' and status='ready' and parent_id='nt-copy' and name='Shared') then raise exception 'Shared immutable file was not retained'; end if;
end $$;
-- A second account cannot read the synthetic source or file.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"020601b8-5bfd-4d88-a196-61492d8dcbb7","role":"authenticated"}',true);
do $$
begin
 begin
  perform public.manor_notes_tool_query('export_note','{"id":"nt-copy","format":"block_json"}');
  raise exception 'Foreign note was exported';
 exception when raise_exception then if sqlerrm<>'Note is unavailable' then raise; end if;
 end;
 begin
  perform public.manor_notes_tool_query('get_file_status','{"id":"69dcb6ec-65d2-4d0d-8b44-c5a1e68c4bed"}');
  raise exception 'Foreign file was exposed';
 exception when raise_exception then if sqlerrm<>'File is unavailable' then raise; end if;
 end;
end $$;
rollback;
