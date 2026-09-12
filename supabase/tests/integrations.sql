begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('66666666-6666-4666-8666-666666666666','authenticated','authenticated','integration@example.invalid',now(),now());
select public.manor_integration_store('connect','66666666-6666-4666-8666-666666666666',jsonb_build_object('provider','google','accountId','synthetic-google','accessToken','synthetic-not-a-token','refreshToken','synthetic-not-a-token','expiresAt',now()+interval '1 hour','username','integration@example.invalid'));
select public.manor_integration_store('calendar_list','66666666-6666-4666-8666-666666666666','{"accountId":"synthetic-google","calendars":[{"id":"primary","name":"Synthetic","color":"#123456"}]}');
select public.manor_integration_store('calendar_page','66666666-6666-4666-8666-666666666666','{"accountId":"synthetic-google","calendarId":"primary","events":[{"id":"test-event","summary":"Synthetic","start":{"date":"2026-09-09"},"end":{"date":"2026-09-10"}}],"windowStart":"2026-09-01T00:00:00Z","windowEnd":"2026-10-01T00:00:00Z","syncToken":"synthetic-cursor"}');
select public.manor_integration_store('oauth_start','66666666-6666-4666-8666-666666666666','{"provider":"google","stateHash":"synthetic-state","verifier":"synthetic-challenge","returnOrigin":"http://127.0.0.1:5173"}');
do $$begin
 if public.manor_integration_store('oauth_lookup',null,'{"stateHash":"synthetic-state"}')->>'return_origin'<>'http://127.0.0.1:5173' then raise exception 'OAuth return origin was not preserved'; end if;
 perform public.manor_integration_store('oauth_consume','66666666-6666-4666-8666-666666666666','{"stateHash":"synthetic-state","challenge":"synthetic-challenge"}');
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
do $$begin
 if (select count(*) from public.calendar_events)<>1 then raise exception 'Owner calendar read failed'; end if;
 begin perform public.manor_integration_store('credentials','66666666-6666-4666-8666-666666666666','{"provider":"google"}'); raise exception 'Browser read credentials'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.calendar_events) then raise exception 'Calendar leaked between owners'; end if; end $$;
reset role;
select public.manor_integration_store('disconnect','66666666-6666-4666-8666-666666666666','{"provider":"google","accountId":"synthetic-google"}');
do $$begin if exists(select 1 from public.calendar_events where user_id='66666666-6666-4666-8666-666666666666') then raise exception 'Disconnect retained calendar cache'; end if; end $$;
rollback;
