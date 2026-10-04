begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ed854702-513a-463b-adba-7563bb3c4dd8','authenticated','authenticated','manor-deadline-test@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ed854702-513a-463b-adba-7563bb3c4dd8","role":"authenticated"}',true);
do $test$
declare result jsonb; saved_record jsonb; day date; series text; command_id uuid:=gen_random_uuid();
begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Deadline test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 day:=(now() at time zone 'America/Los_Angeles')::date;
 perform public.manor_command(gen_random_uuid(),'create_context','{"id":"deadline-context","name":"Work","color":"info","icon":"briefcase","expected_revision":0}');
 result:=public.manor_command(command_id,'create_task',jsonb_build_object('id','deadline-task','title','Timed task','context_id','deadline-context','status','Not started','due',day,'due_time','19:59','expected_revision',0));
 if result->'record'->>'due_time'<>'19:59' then raise exception 'Creation lost minute precision'; end if;
 result:=public.manor_command(command_id,'create_task',jsonb_build_object('id','deadline-task','title','Timed task','context_id','deadline-context','status','Not started','due',day,'due_time','19:59','expected_revision',0));
 if result->>'replayed'<>'true' then raise exception 'Creation retry was not idempotent'; end if;
 result:=public.manor_command(gen_random_uuid(),'update_task','{"id":"deadline-task","title":"Renamed task","expected_revision":1}');
 if result->'record'->>'due_time'<>'19:59' then raise exception 'Sparse update removed the deadline time'; end if;
 saved_record:=public.manor_workspace_query('get_day_overview',jsonb_build_object('date',day))->'tasks'->'items'->0;
 if saved_record->>'due_time'<>'19:59' then raise exception 'Day overview omitted the deadline time'; end if;
 result:=public.manor_command(gen_random_uuid(),'update_task','{"id":"deadline-task","due_time":null,"expected_revision":2}');
 if result->'record'->'due_time'<>'null'::jsonb then raise exception 'Explicit null did not clear the time'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'update_task','{"id":"deadline-task","due_time":"24:00","expected_revision":3}');
  raise exception 'Invalid deadline accepted';
 exception when check_violation then null;
 end;
 if (select revision from public.tasks where id='deadline-task')<>3 then raise exception 'Invalid input changed the task'; end if;
 result:=public.manor_command(gen_random_uuid(),'create_recurring_task',jsonb_build_object('id','deadline-series','title','Repeating task','context_id','deadline-context','status','Not started','due',day,'due_time','12:01','tags','[]'::jsonb,'recurrence','FREQ=DAILY','expected_revision',0));
 if exists(select 1 from public.tasks where series_id='deadline-series' and due_time is distinct from '12:01') then raise exception 'Recurrence materialization lost due time'; end if;
 result:=public.manor_command(gen_random_uuid(),'update_future_task_occurrences',jsonb_build_object('id','deadline-series','new_series_id','deadline-series-updated','due',day,'due_time','16:00','recurrence','FREQ=DAILY','expected_revision',1));
 if exists(select 1 from public.tasks where series_id='deadline-series-updated' and due_time is distinct from '16:00') then raise exception 'Future series edit lost due time'; end if;
 result:=public.manor_command(gen_random_uuid(),'update_future_task_occurrences',jsonb_build_object('id','deadline-series-updated','new_series_id','deadline-series-stopped','due',day,'due_time',null,'recurrence',null,'expected_revision',1));
 if result->'record'->'due_time'<>'null'::jsonb then raise exception 'Stopping recurrence failed to clear due time'; end if;
 result:=public.manor_command(gen_random_uuid(),'convert_task_to_series',jsonb_build_object('id','deadline-task','new_series_id','deadline-converted','due',day,'due_time','08:01','recurrence','FREQ=DAILY','expected_revision',3));
 if exists(select 1 from public.tasks where series_id='deadline-converted' and due_time is distinct from '08:01') then raise exception 'Series conversion lost due time'; end if;
 if not exists(select 1 from public.action_events where object_type='tasks' and changes ? 'due_time') then raise exception 'Deadline changes are absent from history'; end if;
end $test$;
rollback;
