-- Unused contexts may be removed even when none remain. Task references stay protected.
create or replace function manor_private.home_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; old_record jsonb; rid text:=p->>'id'; ctx public.contexts; task public.tasks; block public.scratch_blocks; view_row public.saved_task_views; account public.profiles;
begin
 case op
 when 'save_profile' then
  select * into account from public.profiles where user_id=auth.uid() for update;
  perform manor_private.require_revision(account.revision,(p->>'expected_revision')::bigint,to_jsonb(account));
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown account timezone'; end if;
  if length(p->>'name') not between 1 and 120 then raise exception 'Display name must contain 1 to 120 characters'; end if;
  insert into public.profiles(user_id,name,timezone,settings,revision) values(auth.uid(),p->>'name',p->>'timezone',coalesce(p->'settings','{}'),1)
  on conflict(user_id) do update set name=excluded.name,timezone=excluded.timezone,settings=excluded.settings,revision=public.profiles.revision+1 returning to_jsonb(profiles.*) into r;
 when 'create_context','update_context','remove_context' then
  select * into ctx from public.contexts where user_id=auth.uid() and id=rid for update;
  perform manor_private.require_revision(ctx.revision,(p->>'expected_revision')::bigint,to_jsonb(ctx));
  if op='create_context' then
   insert into public.contexts(user_id,id,name,color,icon) values(auth.uid(),rid,p->>'name',p->>'color',p->>'icon') returning to_jsonb(contexts.*) into r;
  elsif op='update_context' then
   update public.contexts set name=p->>'name',color=p->>'color',icon=p->>'icon',revision=revision+1 where user_id=auth.uid() and id=rid returning to_jsonb(contexts.*) into r;
   update public.tasks set context=p->>'name',revision=revision+1,updated_at=now() where user_id=auth.uid() and context_id=rid and context is distinct from p->>'name';
   update public.saved_task_views set rules=(select jsonb_agg(case when rule->>'property'='context' and rule->>'value'=ctx.name then jsonb_set(rule,'{value}',to_jsonb(p->>'name')) else rule end) from jsonb_array_elements(rules) rule),revision=revision+1 where user_id=auth.uid() and rules @> jsonb_build_array(jsonb_build_object('property','context','value',ctx.name));
  else
   if exists(select 1 from public.tasks where user_id=auth.uid() and (context_id=rid or context=ctx.name)) then raise exception 'Move tasks out of this context before removing it'; end if;
   delete from public.contexts where user_id=auth.uid() and id=rid returning to_jsonb(contexts.*) into r;
  end if;
 when 'create_task','update_task','trash_task','restore_task' then
  select * into task from public.tasks where user_id=auth.uid() and id=rid for update;
  perform manor_private.require_revision(task.revision,(p->>'expected_revision')::bigint,to_jsonb(task));
  if op='create_task' then
   select * into ctx from public.contexts where user_id=auth.uid() and id=p->>'context_id';
   if ctx.id is null then raise exception 'Select an existing context'; end if;
   if p->>'recurrence' is not null then raise exception 'Use a recurrence series command for recurring tasks'; end if;
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,tags,completed_at)
   values(rid,auth.uid(),p->>'title',ctx.name,ctx.id,(p->>'estimate_minutes')::int,p->>'priority',p->>'status',(p->>'due')::date,array(select jsonb_array_elements_text(coalesce(p->'tags','[]'))),case when p->>'status'='Done' then now() end) returning to_jsonb(tasks.*) into r;
  elsif op='update_task' then
   if task.deleted_at is not null then raise exception 'Restore the task before editing it'; end if;
   select * into ctx from public.contexts where user_id=auth.uid() and id=coalesce(p->>'context_id',task.context_id);
   if ctx.id is null then raise exception 'Select an existing context'; end if;
   if p ? 'recurrence' then raise exception 'Use a recurrence series command to change recurrence'; end if;
   update public.tasks set title=coalesce(p->>'title',title),context=ctx.name,context_id=ctx.id,
    estimate_minutes=case when p?'estimate_minutes' then (p->>'estimate_minutes')::int else estimate_minutes end,
    priority=case when p?'priority' then p->>'priority' else priority end,status=coalesce(p->>'status',status),due=coalesce((p->>'due')::date,due),
    tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,
    completed_at=case when p->>'status'='Done' and task.status<>'Done' then now() when p?'status' and p->>'status'<>'Done' then null else completed_at end,
    revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  elsif op='trash_task' then
   if task.deleted_at is not null then raise exception 'Task is already in Trash'; end if;
   update public.tasks set deleted_at=now(),revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  else
   if task.deleted_at is null or task.deleted_at<=now()-interval '7 days' then raise exception 'Task is not recoverable from Trash'; end if;
   update public.tasks set deleted_at=null,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(tasks.*) into r;
  end if;
 when 'save_scratch_block','delete_scratch_block' then
  select * into block from public.scratch_blocks where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(block.revision,(p->>'expected_revision')::bigint,to_jsonb(block));
  if op='delete_scratch_block' then
   delete from public.scratch_blocks where id=rid and user_id=auth.uid() returning to_jsonb(scratch_blocks.*) into r;
  else
   if p->>'start_time'<'06:00' or p->>'end_time'>'24:00' or p->>'start_time'>=p->>'end_time' or substring(p->>'start_time',4,2)::int%15<>0 or substring(p->>'end_time',4,2)::int%15<>0 then raise exception 'Scratch blocks require 15-minute boundaries between 06:00 and midnight'; end if;
   if p->>'task_id' is not null and not exists(select 1 from public.tasks where user_id=auth.uid() and id=p->>'task_id' and deleted_at is null) then raise exception 'Scratch block task is unavailable'; end if;
   insert into public.scratch_blocks(id,user_id,task_id,date,start_time,end_time,portion,expires_at)
    values(rid,auth.uid(),p->>'task_id',(p->>'date')::date,p->>'start_time',p->>'end_time',p->>'portion',(((p->>'date')::date+(p->>'end_time')::time) at time zone (select timezone from public.profiles where user_id=auth.uid()))+interval '48 hours')
   on conflict(id) do update set task_id=excluded.task_id,date=excluded.date,start_time=excluded.start_time,end_time=excluded.end_time,portion=excluded.portion,expires_at=excluded.expires_at,revision=public.scratch_blocks.revision+1 returning to_jsonb(scratch_blocks.*) into r;
  end if;
 when 'save_task_view','delete_task_view' then
  select * into view_row from public.saved_task_views where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(view_row.revision,(p->>'expected_revision')::bigint,to_jsonb(view_row));
  if op='delete_task_view' then delete from public.saved_task_views where id=rid and user_id=auth.uid() returning to_jsonb(saved_task_views.*) into r;
  else
   if jsonb_typeof(p->'rules')<>'array' or jsonb_array_length(p->'rules')>30 then raise exception 'Saved views require at most 30 filter rules'; end if;
   insert into public.saved_task_views(id,user_id,name,rules) values(rid,auth.uid(),p->>'name',p->'rules') on conflict(id) do update set name=excluded.name,rules=excluded.rules,revision=public.saved_task_views.revision+1 returning to_jsonb(saved_task_views.*) into r;
  end if;
 else raise exception 'Unsupported home operation: %',op;
 end case;
 if r is null then raise exception using errcode='P0002',message='Record does not exist or is not owned by this account'; end if;
 return r;
end $$;
alter function manor_private.home_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.home_command(text,jsonb) from public;
