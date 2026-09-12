-- Real domain batch lifecycle integration; all synthetic data rolls back.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('a7c6910c-4b7d-40ad-93b0-1a6a99a2ee81','authenticated','authenticated','lifecycle-tools@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a7c6910c-4b7d-40ad-93b0-1a6a99a2ee81","role":"authenticated"}',true);
do $$ declare commands jsonb; result jsonb; begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Lifecycle test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_context','{"id":"lifecycle-context","name":"Personal","color":"plum","icon":"house","expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_task',jsonb_build_object('id','lifecycle-task','title','Synthetic task','context_id','lifecycle-context','status','Not started','due',current_date,'expected_revision',0));
 perform public.manor_command(gen_random_uuid(),'create_application','{"id":"lifecycle-application","company":"Synthetic","role":"Test","location":"Remote","link":"https://example.invalid/job","stage":"to_apply","expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_note','{"id":"lifecycle-note","title":"Synthetic parent","folder_id":null,"parent_page_id":null,"content_json":[],"expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'create_note','{"id":"lifecycle-child","title":"Synthetic child","folder_id":null,"parent_page_id":"lifecycle-note","content_json":[],"expected_revision":0}');
 -- These are precisely the fixed operation envelopes produced by trash_records.
 commands:=jsonb_build_array(
  jsonb_build_object('command_id',gen_random_uuid(),'operation','trash_task','input',jsonb_build_object('id','lifecycle-task','expected_revision',1)),
  jsonb_build_object('command_id',gen_random_uuid(),'operation','trash_application','input',jsonb_build_object('id','lifecycle-application','expected_revision',1)),
  jsonb_build_object('command_id',gen_random_uuid(),'operation','trash_note','input',jsonb_build_object('id','lifecycle-note','expected_revision',1)));
 result:=public.manor_batch(commands);
 if jsonb_array_length(result)<>3 then raise exception 'Mixed lifecycle batch lost a result'; end if;
 perform public.manor_batch(commands);
 if exists(select 1 from public.note_pages where id in ('lifecycle-note','lifecycle-child') and (status<>'trash' or revision<>2)) then raise exception 'Note hierarchy was not trashed once'; end if;
 if not exists(select 1 from public.tasks where id='lifecycle-task' and deleted_at is not null and revision=2) then raise exception 'Task was not trashed once'; end if;
 if not exists(select 1 from public.job_roles where id='lifecycle-application' and deleted_at is not null and revision=2) then raise exception 'Application was not trashed once'; end if;
 -- A stale revision anywhere must roll back the entire batch.
 begin
  perform public.manor_batch(jsonb_build_array(
   jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_task','input',jsonb_build_object('id','lifecycle-task','expected_revision',2)),
   jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_application','input',jsonb_build_object('id','lifecycle-application','expected_revision',1))));
  raise exception 'Stale lifecycle batch unexpectedly committed';
 exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from public.tasks where id='lifecycle-task' and deleted_at is null) then raise exception 'A failing lifecycle batch partially restored its task'; end if;
 perform public.manor_batch(jsonb_build_array(
  jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_task','input',jsonb_build_object('id','lifecycle-task','expected_revision',2)),
  jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_application','input',jsonb_build_object('id','lifecycle-application','expected_revision',2)),
  jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_note','input',jsonb_build_object('id','lifecycle-note','expected_revision',2))));
 if exists(select 1 from public.note_pages where id in ('lifecycle-note','lifecycle-child') and status<>'active') then raise exception 'Note hierarchy was not restored'; end if;
 if not exists(select 1 from public.note_pages where id='lifecycle-child' and parent_page_id='lifecycle-note') then raise exception 'Restoration lost the parent relationship'; end if;
 perform public.manor_batch(jsonb_build_array(jsonb_build_object('command_id',gen_random_uuid(),'operation','archive_note','input',jsonb_build_object('id','lifecycle-note','expected_revision',3))));
 if not exists(select 1 from public.note_pages where id='lifecycle-note' and status='archived' and deleted_at is null) then raise exception 'Archive incorrectly used Trash'; end if;
 perform public.manor_batch(jsonb_build_array(jsonb_build_object('command_id',gen_random_uuid(),'operation','restore_note','input',jsonb_build_object('id','lifecycle-note','expected_revision',4))));
 if not exists(select 1 from public.note_pages where id='lifecycle-note' and status='active' and revision=5) then raise exception 'Unarchive did not return the note to active'; end if;
end $$;
rollback;
