-- Supplemental Notes operations run inside manor_command's account lock and receipt.
create function manor_private.copy_note_blocks(blocks jsonb) returns jsonb language plpgsql volatile set search_path='' as $$
declare result jsonb:='[]'; b jsonb;
begin
 for b in select value from jsonb_array_elements(blocks) loop
  b:=jsonb_set(b,'{id}',to_jsonb(gen_random_uuid()::text));
  if b?'children' then b:=jsonb_set(b,'{children}',manor_private.copy_note_blocks(b->'children')); end if;
  result:=result||jsonb_build_array(b);
 end loop;
 return result;
end $$;

create function manor_private.validate_note_files(content jsonb) returns void language plpgsql set search_path='' as $$
declare url text; file_id uuid;
begin
 for url in select trim(both '"' from value::text) from jsonb_path_query(content,'lax $.**.url') as urls(value) loop
  if url like 'manor-attachment://%' then
   file_id:=substring(url from 20)::uuid;
   if not exists(select 1 from public.file_objects f where f.id=file_id and f.user_id=auth.uid() and f.purpose='note' and f.status='ready'
    and exists(select 1 from public.note_pages n where n.id=f.parent_id and n.user_id=f.user_id and n.status<>'trash')) then
    raise exception 'Attachment % must be an owned, ready file belonging to an available note',file_id;
   end if;
  end if;
 end loop;
end $$;

-- A file referenced by another retained document must survive its original parent's purge.
create function manor_private.retain_shared_note_file() returns trigger language plpgsql security definer set search_path='' as $$
declare survivor text; stable_url text:='manor-attachment://'||old.id::text;
begin
 if old.purpose<>'note' or old.status<>'ready' or new.status<>'purging' then return new; end if;
 select n.id into survivor from public.note_pages n where n.user_id=old.user_id and n.id<>old.parent_id
  and (n.status<>'trash' or n.deleted_at>now()-interval '7 days')
  and (jsonb_path_exists(n.content_json,'lax $.**.url ? (@ == $url)',jsonb_build_object('url',stable_url))
   or exists(select 1 from public.note_versions v where v.user_id=n.user_id and v.note_id=n.id and v.created_at>now()-interval '7 days'
    and jsonb_path_exists(v.content_json,'lax $.**.url ? (@ == $url)',jsonb_build_object('url',stable_url)))) order by n.id limit 1;
 if survivor is not null then
  new.status:=old.status; new.name:=old.name; new.parent_id:=survivor;
  update public.note_attachments set note_id=survivor where user_id=old.user_id and id=old.id;
 end if;
 return new;
end $$;
create trigger retain_shared_note_file before update of status on public.file_objects for each row execute function manor_private.retain_shared_note_file();

-- Keep shared attachments downloadable when their allocation parent enters Trash.
create function manor_private.rehome_shared_note_files() returns trigger language plpgsql security definer set search_path='' as $$
declare f public.file_objects; survivor text;
begin
 if new.status<>'trash' or old.status='trash' then return new; end if;
 for f in select * from public.file_objects where user_id=new.user_id and purpose='note' and parent_id=new.id and status='ready' for update loop
  select n.id into survivor from public.note_pages n where n.user_id=new.user_id and n.id<>new.id and n.status<>'trash'
   and (jsonb_path_exists(n.content_json,'lax $.**.url ? (@ == $url)',jsonb_build_object('url','manor-attachment://'||f.id::text))
    or exists(select 1 from public.note_versions v where v.user_id=n.user_id and v.note_id=n.id and v.created_at>now()-interval '7 days'
     and jsonb_path_exists(v.content_json,'lax $.**.url ? (@ == $url)',jsonb_build_object('url','manor-attachment://'||f.id::text)))) order by n.id limit 1;
  if survivor is not null then
   update public.file_objects set parent_id=survivor where id=f.id;
   update public.note_attachments set note_id=survivor where user_id=new.user_id and id=f.id;
  end if;
 end loop;
 return new;
end $$;
create trigger rehome_shared_note_files after update of status on public.note_pages for each row execute function manor_private.rehome_shared_note_files();
revoke all on function manor_private.rehome_shared_note_files() from public,anon,authenticated;

create function manor_private.notes_tool_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare n public.note_pages; source public.note_pages; f public.note_folders; item record; mapping jsonb:='{}'; copied jsonb; selected text; b jsonb; result jsonb; ids text[]; seen text[]:='{}'; new_id text;
begin
 if op='remove_empty_note_folder' then
  select * into f from public.note_folders where user_id=auth.uid() and id=p->>'id' and deleted_at is null for update;
  if f.id is null then raise exception 'Folder is unavailable'; end if;
  perform manor_private.require_revision(f.revision,(p->>'expected_revision')::bigint,to_jsonb(f));
  if exists(select 1 from public.note_pages where user_id=auth.uid() and folder_id=f.id)
   or exists(select 1 from public.note_folders where user_id=auth.uid() and parent_folder_id=f.id and deleted_at is null) then
   raise exception 'Folder is not empty; move its notes (including Trash) and child folders before removing it';
  end if;
  return manor_private.notes_command('remove_note_folder',p);
 elsif op='import_note' then
  if p->>'format' is distinct from 'block_json' then raise exception 'Supported import format: block_json'; end if;
  perform manor_private.validate_note_files(p->'content_json');
  return manor_private.notes_command('create_note',p);
 end if;
 select * into source from public.note_pages where user_id=auth.uid() and id=p->>'id' and status<>'trash' for update;
 if source.id is null then raise exception 'Source note is unavailable'; end if;
 perform manor_private.require_revision(source.revision,(p->>'expected_revision')::bigint,to_jsonb(source));
 if op='duplicate_note' then
  with recursive tree as (select id,parent_page_id,0 depth from public.note_pages where user_id=auth.uid() and id=source.id
   union all select child.id,child.parent_page_id,tree.depth+1 from public.note_pages child join tree on child.parent_page_id=tree.id where child.user_id=auth.uid() and child.status<>'trash')
  select array_agg(id order by depth,id) into ids from tree;
  if cardinality(ids)>100 then raise exception 'Duplicate at most 100 notes in one subtree'; end if;
  foreach selected in array ids loop
   select * into n from public.note_pages where user_id=auth.uid() and id=selected for update;
   new_id:=case when selected=source.id then p->>'new_id' else gen_random_uuid()::text end;
   mapping:=mapping||jsonb_build_object(selected,new_id);
   perform manor_private.validate_note_files(n.content_json);
   copied:=manor_private.copy_note_blocks(n.content_json);
   result:=manor_private.notes_command('create_note',jsonb_build_object('id',new_id,'expected_revision',0,'title',case when selected=source.id then p->>'title' else n.title end,
    'folder_id',case when selected=source.id then p->>'folder_id' else n.folder_id end,
    'parent_page_id',case when selected=source.id then p->>'parent_page_id' else mapping->>n.parent_page_id end,'content_json',copied));
  end loop;
  return jsonb_build_object('id',p->>'new_id','note_ids',mapping,'count',cardinality(ids));
 elsif op='duplicate_note_blocks' then
  select * into n from public.note_pages where user_id=auth.uid() and id=p->>'target_note_id' and status<>'trash' for update;
  if n.id is null then raise exception 'Target note is unavailable'; end if;
  perform manor_private.require_revision(n.revision,(p->>'target_expected_revision')::bigint,to_jsonb(n));
  if jsonb_typeof(p->'block_ids') is distinct from 'array' or jsonb_array_length(p->'block_ids') not between 1 and 50 then raise exception 'Select 1 to 50 blocks'; end if;
  copied:='[]';
  for selected in select jsonb_array_elements_text(p->'block_ids') loop
   if selected=any(seen) then raise exception 'Duplicate block selection: %',selected; end if;
   seen:=array_append(seen,selected);
   b:=manor_private.find_block(source.content_json,selected);
   if b is null then raise exception 'Source block is unavailable: %',selected; end if;
   copied:=copied||manor_private.copy_note_blocks(jsonb_build_array(b));
  end loop;
  perform manor_private.validate_note_files(copied);
  return manor_private.notes_command('update_note',jsonb_build_object('id',n.id,'expected_revision',n.revision,'content_json',n.content_json||copied));
 elsif op='edit_note_media' then
  -- The complete native block is supplied so captions, dimensions, and formatting remain lossless.
  perform manor_private.validate_note_files(p->'edits');
  for item in select value edit from jsonb_array_elements(p->'edits') loop
   if coalesce(item.edit->>'kind','') not in ('replace','insert_before','insert_after','append') or coalesce(item.edit->'block'->>'type','') not in ('image','video','audio','file')
    or coalesce(item.edit->'block'->'props'->>'url','') not like 'manor-attachment://%' then
    raise exception 'Media edits require image, video, audio, or file blocks with an owned manor-attachment URL';
   end if;
  end loop;
  return manor_private.edit_note_blocks(p);
 end if;
 raise exception 'Unsupported supplemental Notes operation: %',op;
end $$;

create function public.manor_notes_tool_query(p_query text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.note_pages; result jsonb; take integer:=(p_input->>'limit')::integer; needle text:=p_input->>'search';
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_query='get_file_status' then
  select jsonb_build_object('id',f.id,'name',f.name,'status',f.status,'size',f.size,'mime_type',f.mime_type,'created_at',f.created_at,'finalized_at',f.finalized_at)
   into result from public.file_objects f where f.user_id=auth.uid() and f.id=(p_input->>'id')::uuid and f.status<>'purging'
    and (f.purpose<>'note' or exists(select 1 from public.note_pages parent_note where parent_note.id=f.parent_id and parent_note.user_id=f.user_id and parent_note.status<>'trash'));
  if result is null then raise exception 'File is unavailable'; end if;
  return result;
 end if;
 select * into n from public.note_pages where user_id=auth.uid() and id=p_input->>'id' and status<>'trash';
 if n.id is null then raise exception 'Note is unavailable'; end if;
 if p_query='export_note' then
  if p_input->>'format' is distinct from 'block_json' then raise exception 'Supported export format: block_json'; end if;
  return jsonb_build_object('format','block_json','id',n.id,'revision',n.revision,'title',n.title,'content_json',n.content_json);
 elsif p_query='find_in_note' then
  if needle is null or length(needle) not between 1 and 500 or take is null or take not between 1 and 200 then raise exception 'Supply search (1 to 500 characters) and limit (1 to 200)'; end if;
  with recursive tree as (select value b from jsonb_array_elements(n.content_json) union all select child.value from tree cross join lateral jsonb_array_elements(coalesce(tree.b->'children','[]')) child),
  matches as (select b->>'id' block_id,b-'children' content from tree where strpos(lower((b-'children')::text),lower(needle))>0 and (p_input->>'cursor' is null or b->>'id'>p_input->>'cursor') order by b->>'id' limit take+1),
  page as (select * from matches order by block_id limit take)
  select jsonb_build_object('id',n.id,'revision',n.revision,'items',coalesce((select jsonb_agg(to_jsonb(page) order by block_id) from page),'[]'),
   'next_cursor',case when (select count(*) from matches)>take then (select max(block_id) from page) end) into result;
  return result;
 end if;
 raise exception 'Unsupported supplemental Notes query: %',p_query;
end $$;

grant create on schema manor_private,public to manor_commands;
alter function manor_private.notes_tool_command(text,jsonb) owner to manor_commands;
alter function public.manor_notes_tool_query(text,jsonb) owner to manor_commands;
revoke create on schema manor_private,public from manor_commands;
revoke all on function manor_private.copy_note_blocks(jsonb),manor_private.validate_note_files(jsonb),manor_private.retain_shared_note_file(),manor_private.notes_tool_command(text,jsonb),public.manor_notes_tool_query(text,jsonb) from public,anon,authenticated;
grant execute on function manor_private.copy_note_blocks(jsonb),manor_private.validate_note_files(jsonb) to manor_commands;
grant execute on function public.manor_notes_tool_query(text,jsonb) to authenticated;
