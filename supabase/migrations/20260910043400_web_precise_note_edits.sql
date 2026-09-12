grant create on schema manor_private to manor_commands;
create function manor_private.insert_adjacent(blocks jsonb,target text,addition jsonb,placement text) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]'; b jsonb;
begin
 for b in select value from jsonb_array_elements(blocks) loop
  if b->>'id'=target and placement='before' then result:=result||jsonb_build_array(addition); end if;
  if b?'children' then b:=jsonb_set(b,'{children}',manor_private.insert_adjacent(b->'children',target,addition,placement)); end if;
  result:=result||jsonb_build_array(b);
  if b->>'id'=target and placement='after' then result:=result||jsonb_build_array(addition); end if;
 end loop;
 return result;
end $$;
revoke all on function manor_private.insert_adjacent(jsonb,text,jsonb,text) from public;
grant execute on function manor_private.insert_adjacent(jsonb,text,jsonb,text) to manor_commands;
create function manor_private.edit_note_blocks(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare note public.note_pages; content jsonb; edit jsonb; anchor jsonb;
begin
 select * into note from public.note_pages where id=p->>'id' and user_id=auth.uid() and status<>'trash' for update;
 if note.id is null then raise exception 'Note is unavailable'; end if;
 perform manor_private.require_revision(note.revision,(p->>'expected_revision')::bigint,to_jsonb(note));
 if jsonb_typeof(p->'edits') is distinct from 'array' or jsonb_array_length(p->'edits') not between 1 and 100 then raise exception 'Apply 1 to 100 explicit block edits'; end if;
 content:=note.content_json;
 for edit in select value from jsonb_array_elements(p->'edits') loop
  if edit->>'kind'<>'append' then
   anchor:=manor_private.find_block(content,edit->>'block_id');
   if anchor is null then raise exception 'Block anchor is unavailable: %',edit->>'block_id'; end if;
  end if;
  case edit->>'kind'
   when 'replace' then
    if edit->'block'->>'id' is distinct from edit->>'block_id' then raise exception 'Replacement must preserve the block ID'; end if;
    content:=manor_private.replace_block(content,edit->>'block_id',edit->'block');
   when 'delete' then content:=manor_private.replace_block(content,edit->>'block_id','null');
   when 'insert_before' then content:=manor_private.insert_adjacent(content,edit->>'block_id',edit->'block','before');
   when 'insert_after' then content:=manor_private.insert_adjacent(content,edit->>'block_id',edit->'block','after');
   when 'append' then content:=content||jsonb_build_array(edit->'block');
   else raise exception 'Unsupported block edit kind: %',edit->>'kind';
  end case;
 end loop;
 perform manor_private.validate_blocks(content);
 return manor_private.notes_command('update_note',jsonb_build_object('id',note.id,'expected_revision',note.revision,'content_json',content));
end $$;
alter function manor_private.edit_note_blocks(jsonb) owner to manor_commands;
revoke all on function manor_private.edit_note_blocks(jsonb) from public;
revoke create on schema manor_private from manor_commands;
