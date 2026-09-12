-- Isolated staging integration: all synthetic records roll back.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eceafa2e-9bad-4978-9225-a57f90688919','authenticated','authenticated','manor-context-test@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eceafa2e-9bad-4978-9225-a57f90688919","role":"authenticated"}',true);
do $$
declare removal_id uuid := gen_random_uuid();
begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Context test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_context','{"id":"context-empty-test","name":"Personal","color":"plum","icon":"house","expected_revision":0}');
 perform public.manor_command(removal_id,'remove_context','{"id":"context-empty-test","expected_revision":1}');
 perform public.manor_command(removal_id,'remove_context','{"id":"context-empty-test","expected_revision":1}');
 if exists(select 1 from public.contexts) then raise exception 'The last unused context was not removed'; end if;
 if jsonb_array_length(public.manor_query('list_contexts','{}')->'items')<>0 then raise exception 'The tool query did not return an empty context list'; end if;

 -- An empty account can create its first context and then use it for a task.
 perform public.manor_command(gen_random_uuid(),'create_context','{"id":"context-first-test","name":"Work","color":"info","icon":"briefcase","expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_task',jsonb_build_object('id','context-task-test','title','Synthetic referenced task','context_id','context-first-test','status','Not started','due',current_date,'expected_revision',0));
 begin
  perform public.manor_command(gen_random_uuid(),'remove_context','{"id":"context-first-test","expected_revision":1}');
  raise exception 'A task-referenced context was removed';
 exception when raise_exception then
  if sqlerrm<>'Move tasks out of this context before removing it' then raise; end if;
 end;
 perform public.manor_command(gen_random_uuid(),'trash_task','{"id":"context-task-test","expected_revision":1}');
 begin
  perform public.manor_command(gen_random_uuid(),'remove_context','{"id":"context-first-test","expected_revision":1}');
  raise exception 'A recoverable task lost its context';
 exception when raise_exception then
  if sqlerrm<>'Move tasks out of this context before removing it' then raise; end if;
 end;
 perform public.manor_command(gen_random_uuid(),'restore_task','{"id":"context-task-test","expected_revision":2}');
 if not exists(select 1 from public.tasks where id='context-task-test' and deleted_at is null and context_id='context-first-test') then raise exception 'Task restoration lost its context'; end if;
 if (select count(*) from public.contexts)<>1 then raise exception 'The referenced context was not preserved'; end if;
end $$;
rollback;
