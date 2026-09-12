create function manor_private.validate_blocks(blocks jsonb) returns void language plpgsql set search_path='' as $$
declare ids text[];
begin
 if blocks is null or jsonb_typeof(blocks)<>'array' or octet_length(blocks::text)>12582912 then raise exception 'Note content must be a block array no larger than 12 MB'; end if;
 with recursive tree as (select value b from jsonb_array_elements(blocks) union all select child.value from tree cross join lateral jsonb_array_elements(coalesce(tree.b->'children','[]')) child)
 select array_agg(b->>'id') into ids from tree;
 if exists(select 1 from unnest(ids) id where id is null or length(id)=0) or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Every note block must have a unique stable ID'; end if;
end $$;
create function manor_private.replace_block(blocks jsonb,target text,replacement jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb:='[]'; b jsonb;
begin
 for b in select value from jsonb_array_elements(blocks) loop
  if b->>'id'=target then
   if replacement<>'null'::jsonb then result:=result||jsonb_build_array(replacement); end if;
  else
   if b?'children' then b:=jsonb_set(b,'{children}',manor_private.replace_block(b->'children',target,replacement)); end if;
   result:=result||jsonb_build_array(b);
  end if;
 end loop;
 return result;
end $$;
create function manor_private.find_block(blocks jsonb,target text) returns jsonb language sql set search_path='' as $$
 with recursive tree as (select value b from jsonb_array_elements(blocks) union all select child.value from tree cross join lateral jsonb_array_elements(coalesce(tree.b->'children','[]')) child)
 select b from tree where b->>'id'=target
$$;
revoke all on function manor_private.validate_blocks(jsonb),manor_private.replace_block(jsonb,text,jsonb),manor_private.find_block(jsonb,text) from public;
grant execute on function manor_private.validate_blocks(jsonb),manor_private.replace_block(jsonb,text,jsonb),manor_private.find_block(jsonb,text) to manor_commands;

create function manor_private.notes_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare page public.note_pages; folder public.note_folders; suggestion public.note_suggestions; version public.note_versions; rid text:=p->>'id'; r jsonb; content jsonb; selected_id text; descendants text[]; base_status text;
begin
 if op in ('create_note_folder','update_note_folder','remove_note_folder') then
  select * into folder from public.note_folders where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(folder.revision,(p->>'expected_revision')::bigint,to_jsonb(folder));
  if folder.deleted_at is not null then raise exception 'Folder was removed'; end if;
  if p->>'parent_folder_id' is not null then
   if not exists(select 1 from public.note_folders where user_id=auth.uid() and id=p->>'parent_folder_id' and deleted_at is null) then raise exception 'Parent folder is unavailable'; end if;
   if exists(with recursive ancestors as (select id,parent_folder_id from public.note_folders where id=p->>'parent_folder_id' and user_id=auth.uid() union all select f.id,f.parent_folder_id from public.note_folders f join ancestors a on f.id=a.parent_folder_id where f.user_id=auth.uid()) select 1 from ancestors where id=rid) then raise exception 'A folder cannot contain itself'; end if;
  end if;
  if op='create_note_folder' then
   insert into public.note_folders(id,user_id,name,parent_folder_id) values(rid,auth.uid(),p->>'name',p->>'parent_folder_id') returning to_jsonb(note_folders.*) into r;
  elsif op='update_note_folder' then
   update public.note_folders set name=coalesce(p->>'name',name),parent_folder_id=case when p?'parent_folder_id' then p->>'parent_folder_id' else parent_folder_id end,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(note_folders.*) into r;
  else
   if folder.id is null then raise exception 'Folder is unavailable'; end if;
   update public.note_folders set parent_folder_id=folder.parent_folder_id,revision=revision+1,updated_at=now() where user_id=auth.uid() and parent_folder_id=rid;
   update public.note_pages set folder_id=folder.parent_folder_id,revision=revision+1,updated_at=now() where user_id=auth.uid() and folder_id=rid;
   update public.note_folders set deleted_at=now(),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(note_folders.*) into r;
  end if;
  return r;
 end if;
 select * into page from public.note_pages where id=rid and user_id=auth.uid() for update;
 perform manor_private.require_revision(page.revision,(p->>'expected_revision')::bigint,to_jsonb(page));
 if op<>'create_note' and page.id is null then raise exception 'Note is unavailable'; end if;
 if page.status='trash' and op<>'restore_note' then raise exception 'Restore the note before editing it'; end if;
 if p->>'parent_page_id' is not null then
  if not exists(select 1 from public.note_pages where user_id=auth.uid() and id=p->>'parent_page_id' and status<>'trash') then raise exception 'Parent note is unavailable'; end if;
  if exists(with recursive ancestors as (select id,parent_page_id from public.note_pages where id=p->>'parent_page_id' and user_id=auth.uid() union all select n.id,n.parent_page_id from public.note_pages n join ancestors a on n.id=a.parent_page_id where n.user_id=auth.uid()) select 1 from ancestors where id=rid) then raise exception 'A note cannot contain itself'; end if;
 end if;
 if p->>'folder_id' is not null and not exists(select 1 from public.note_folders where user_id=auth.uid() and id=p->>'folder_id' and deleted_at is null) then raise exception 'Folder is unavailable'; end if;
 if page.id is not null then
  insert into public.note_versions(user_id,note_id,revision,title,content_json) values(auth.uid(),rid,page.revision,page.title,page.content_json) on conflict do nothing;
 end if;
 case op
 when 'create_note' then
  perform manor_private.validate_blocks(p->'content_json');
  insert into public.note_pages(id,user_id,title,folder_id,parent_page_id,content_json) values(rid,auth.uid(),p->>'title',p->>'folder_id',p->>'parent_page_id',p->'content_json') returning to_jsonb(note_pages.*) into r;
 when 'update_note','move_note','archive_note' then
  content:=case when p?'content_json' then p->'content_json' else page.content_json end;
  perform manor_private.validate_blocks(content);
  update public.note_pages set title=coalesce(p->>'title',title),content_json=content,
   folder_id=case when p?'folder_id' then p->>'folder_id' else folder_id end,
   parent_page_id=case when p?'parent_page_id' then p->>'parent_page_id' else parent_page_id end,
   favorite=coalesce((p->>'favorite')::boolean,favorite),
   status=case when op='archive_note' then 'archived' else status end,
   archived_at=case when op='archive_note' then now() else archived_at end,
   revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(note_pages.*) into r;
 when 'trash_note' then
  with recursive tree as (select id from public.note_pages where id=rid and user_id=auth.uid() union all select n.id from public.note_pages n join tree t on n.parent_page_id=t.id where n.user_id=auth.uid() and n.status<>'trash') select array_agg(id) into descendants from tree;
  update public.note_pages set pre_trash_status=status,status='trash',deleted_at=now(),trash_root_id=rid,revision=revision+1,updated_at=now() where user_id=auth.uid() and id=any(descendants);
  select to_jsonb(n.*) into r from public.note_pages n where id=rid and user_id=auth.uid();
 when 'restore_note' then
  if page.status='archived' then
   update public.note_pages set status='active',archived_at=null,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(note_pages.*) into r;
  else
   if page.status<>'trash' or page.deleted_at<=now()-interval '7 days' then raise exception 'Note is not recoverable from Trash'; end if;
   if page.parent_page_id is not null and exists(select 1 from public.note_pages where id=page.parent_page_id and user_id=auth.uid() and status='trash') then raise exception 'Restore the parent note first'; end if;
   update public.note_pages set status=coalesce(pre_trash_status,'active'),deleted_at=null,trash_root_id=null,pre_trash_status=null,revision=revision+1,updated_at=now() where user_id=auth.uid() and (id=rid or trash_root_id=rid) and deleted_at>now()-interval '7 days';
   select to_jsonb(n.*) into r from public.note_pages n where id=rid and user_id=auth.uid();
  end if;
 when 'restore_note_version' then
  select * into version from public.note_versions where user_id=auth.uid() and note_id=rid and revision=(p->>'version_revision')::bigint;
  if version.note_id is null then raise exception 'Note version is unavailable'; end if;
  update public.note_pages set title=version.title,content_json=version.content_json,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(note_pages.*) into r;
 when 'propose_note_edits' then
  content:=manor_private.find_block(page.content_json,p->>'block_id');
  if content is null or content is distinct from p->'before_content_json' then raise exception using errcode='PT409',message='The selected block changed'; end if;
  if p->'after_content_json'<>'null'::jsonb and p->'after_content_json'->>'id' is distinct from p->>'block_id' then raise exception 'A suggestion must preserve the target block ID'; end if;
  perform manor_private.validate_blocks(manor_private.replace_block(page.content_json,p->>'block_id',p->'after_content_json'));
  insert into public.note_suggestions(id,user_id,note_id,base_revision,block_id,before_content_json,after_content_json,description,status)
  values(p->>'suggestion_id',auth.uid(),rid,page.revision,p->>'block_id',content,p->'after_content_json',p->>'description','pending') returning to_jsonb(note_suggestions.*) into r;
 when 'resolve_note_suggestions' then
  if p->>'decision' not in ('accepted','rejected') or jsonb_array_length(p->'suggestion_ids') not between 1 and 50 then raise exception 'Resolve 1 to 50 suggestions with accepted or rejected'; end if;
  content:=page.content_json;
  for selected_id in select jsonb_array_elements_text(p->'suggestion_ids') loop
   select * into suggestion from public.note_suggestions where id=selected_id and note_id=rid and user_id=auth.uid() for update;
   if suggestion.id is null or suggestion.status<>'pending' then raise exception 'Suggestion is unavailable or already resolved'; end if;
   if p->>'decision'='accepted' then
    if manor_private.find_block(content,suggestion.block_id) is distinct from suggestion.before_content_json then raise exception using errcode='PT409',message='Suggestion target changed; resolve the conflicting block first'; end if;
    content:=manor_private.replace_block(content,suggestion.block_id,suggestion.after_content_json);
   end if;
   update public.note_suggestions set status=p->>'decision',resolved_at=now(),revision=revision+1 where id=selected_id and user_id=auth.uid();
  end loop;
  perform manor_private.validate_blocks(content);
  update public.note_pages set content_json=content,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(note_pages.*) into r;
 else raise exception 'Unsupported Notes operation: %',op;
 end case;
 return r;
end $$;
alter function manor_private.notes_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.notes_command(text,jsonb) from public;
