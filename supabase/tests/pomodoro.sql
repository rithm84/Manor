-- Run after migrations in a transaction and always roll back these test writes.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('99999999-9999-4999-9999-999999999999','authenticated','authenticated','pomodoro@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-9999-999999999999","role":"authenticated"}',true);
select public.manor_command(gen_random_uuid(),'save_profile','{"name":"Pomodoro test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
do $$declare result jsonb; rec jsonb; queried jsonb;
begin
 -- Preferences merge into the profile and bump its revision; unknown keys and bad values are refused.
 result:=public.manor_command(gen_random_uuid(),'save_pomodoro_settings','{"expected_revision":1,"settings":{"focus_minutes":50,"auto_start_breaks":true}}');
 if result->'record'->'settings'->'pomodoro'->>'focus_minutes'<>'50' or (result->'record'->>'revision')::int<>2 then raise exception 'Preferences did not save'; end if;
 result:=public.manor_command(gen_random_uuid(),'save_pomodoro_settings','{"expected_revision":2,"settings":{"short_break_minutes":7}}');
 if result->'record'->'settings'->'pomodoro'->>'focus_minutes'<>'50' or result->'record'->'settings'->'pomodoro'->>'short_break_minutes'<>'7' then raise exception 'Preferences did not merge'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_pomodoro_settings','{"expected_revision":3,"settings":{"focus_minutes":0}}');
  raise exception 'Zero-minute focus was accepted';
 exception when raise_exception then if sqlerrm not like '%1 to 180%' then raise; end if; end;
 begin
  perform public.manor_command(gen_random_uuid(),'save_pomodoro_settings','{"expected_revision":3,"settings":{"color":"red"}}');
  raise exception 'Unknown preference was accepted';
 exception when raise_exception then if sqlerrm not like 'Unknown timer preference%' then raise; end if; end;

 -- Start, pause, resume, and the single active session rule.
 result:=public.manor_command(gen_random_uuid(),'start_pomodoro_session','{"id":"pomo-1","expected_revision":0,"kind":"focus","planned_seconds":1500,"label":"  Write tests  "}');
 rec:=result->'record';
 if rec->>'status'<>'running' or rec->>'label'<>'Write tests' or rec->>'local_date' is null then raise exception 'Start did not record a running session'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'start_pomodoro_session','{"id":"pomo-2","expected_revision":0,"kind":"focus","planned_seconds":1500}');
  raise exception 'Second concurrent session was accepted';
 exception when sqlstate '55000' then null; end;
 begin
  perform public.manor_command(gen_random_uuid(),'end_pomodoro_session','{"id":"pomo-1","expected_revision":1,"outcome":"completed"}');
  raise exception 'Unfinished session was marked completed';
 exception when sqlstate '55000' then null; end;
 result:=public.manor_command(gen_random_uuid(),'pause_pomodoro_session','{"id":"pomo-1","expected_revision":1}');
 if result->'record'->>'status'<>'paused' or result->'record'->>'paused_at' is null then raise exception 'Pause did not record'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'pause_pomodoro_session','{"id":"pomo-1","expected_revision":2}');
  raise exception 'Paused session was paused again';
 exception when raise_exception then if sqlerrm not like 'Only a running%' then raise; end if; end;
 result:=public.manor_command(gen_random_uuid(),'resume_pomodoro_session','{"id":"pomo-1","expected_revision":2}');
 if result->'record'->>'status'<>'running' or result->'record'->>'paused_at' is not null or (result->'record'->>'revision')::int<>3 then raise exception 'Resume did not record'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'pause_pomodoro_session','{"id":"pomo-1","expected_revision":1}');
  raise exception 'Stale revision was accepted';
 exception when sqlstate 'PT409' then null; end;

 -- Abandoning keeps the focused time that elapsed, capped by the plan, and frees the active slot.
 result:=public.manor_command(gen_random_uuid(),'end_pomodoro_session','{"id":"pomo-1","expected_revision":3,"outcome":"abandoned"}');
 rec:=result->'record';
 if rec->>'status'<>'abandoned' or rec->>'ended_at' is null or (rec->>'focused_seconds')::int not between 0 and 1500 then raise exception 'Abandon did not close the session'; end if;
 perform public.manor_command(gen_random_uuid(),'update_pomodoro_session','{"id":"pomo-1","expected_revision":4,"label":"Renamed"}');
 result:=public.manor_command(gen_random_uuid(),'start_pomodoro_session','{"id":"pomo-2","expected_revision":0,"kind":"short_break","planned_seconds":300}');
 if result->'record'->>'kind'<>'short_break' then raise exception 'Break session did not start after the focus session ended'; end if;
 perform public.manor_command(gen_random_uuid(),'delete_pomodoro_session','{"id":"pomo-2","expected_revision":1}');
 if exists(select 1 from public.pomodoro_sessions where id='pomo-2') then raise exception 'Delete left the session behind'; end if;

 -- Backfilled sessions must already have ended and count as completed focus.
 result:=public.manor_command(gen_random_uuid(),'log_pomodoro_session',jsonb_build_object('id','pomo-3','expected_revision',0,'started_at',now()-interval '2 hours','focused_seconds',1500,'label','Backfill'));
 if result->'record'->>'status'<>'completed' or (result->'record'->>'focused_seconds')::int<>1500 then raise exception 'Logged session was not completed'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'log_pomodoro_session',jsonb_build_object('id','pomo-4','expected_revision',0,'started_at',now()-interval '10 minutes','focused_seconds',1500));
  raise exception 'Future-ending logged session was accepted';
 exception when raise_exception then if sqlerrm not like '%already ended%' then raise; end if; end;

 -- The agent read returns finished sessions newest first with a range summary and the active session.
 queried:=public.manor_pomodoro_query('query_pomodoro_sessions',jsonb_build_object('from',(now() at time zone 'America/Los_Angeles')::date-1,'to',(now() at time zone 'America/Los_Angeles')::date,'limit',50));
 if jsonb_array_length(queried->'items')<>2 or queried->'items'->0->>'id'<>'pomo-1' then raise exception 'Query did not list finished sessions newest first: %',queried; end if;
 if (queried->'summary'->>'completed_sessions')::int<>1 or (queried->'summary'->>'abandoned_sessions')::int<>1 then raise exception 'Summary counts are wrong: %',queried->'summary'; end if;
 if queried->'active' is distinct from 'null'::jsonb then raise exception 'No session should be active'; end if;
 perform public.manor_command(gen_random_uuid(),'start_pomodoro_session','{"id":"pomo-5","expected_revision":0,"kind":"focus","planned_seconds":1500}');
 queried:=public.manor_pomodoro_query('query_pomodoro_sessions','{"limit":1}');
 if queried->'active'->>'id'<>'pomo-5' or queried->>'next_cursor' is null then raise exception 'Active session or cursor missing: %',queried; end if;
 if (select count(*) from public.action_events where object_type='pomodoro_sessions')<8 then raise exception 'Action history did not record the session changes'; end if;
end $$;
rollback;
