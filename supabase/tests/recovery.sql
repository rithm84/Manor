-- Synthetic staging integration, including external checkpoint acknowledgement boundary.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('55555555-5555-4555-8555-555555555555','authenticated','authenticated','recovery@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
select public.manor_command(gen_random_uuid(),'save_profile','{"name":"Recovery test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
select public.manor_command(gen_random_uuid(),'create_context','{"id":"recovery-context","name":"Test","color":"plum","icon":"house","expected_revision":0}');
select public.manor_command(gen_random_uuid(),'create_recurring_task',jsonb_build_object('id','recovery-series','title','Recoverable','context_id','recovery-context','due',(now() at time zone 'America/Los_Angeles')::date,'recurrence','FREQ=DAILY','expected_revision',0));
select public.manor_command(gen_random_uuid(),'trash_task','{"id":"recovery-series","expected_revision":1}');
reset role;
update public.tasks set deleted_at=now()-interval '8 days' where user_id='55555555-5555-4555-8555-555555555555' and id='recovery-series';
select public.manor_prepare_purge();
select public.manor_purge_expired();
do $$begin if not exists(select 1 from public.tasks where id='recovery-series') then raise exception 'Purged before external ledger acknowledgement'; end if; end $$;
select public.manor_acknowledge_recovery(repeat('a',64),(select jsonb_agg(to_jsonb(t)) from manor_private.purge_tombstones t where user_id='55555555-5555-4555-8555-555555555555'));
select public.manor_purge_expired();
do $$begin
 if exists(select 1 from public.tasks where id='recovery-series') then raise exception 'Acknowledged row was not purged'; end if;
 if exists(select 1 from public.action_events where user_id='55555555-5555-4555-8555-555555555555' and object_type='tasks' and object_id='recovery-series') then raise exception 'History retained purged content'; end if;
 if public.manor_purge_expired()<>0 then raise exception 'Purge repeated an absent source'; end if;
end $$;
update public.task_series set materialized_through=null where user_id='55555555-5555-4555-8555-555555555555';
set local role manor_commands;
select manor_private.materialize_series('recovery-series');
reset role;
do $$begin if exists(select 1 from public.tasks where id='recovery-series') then raise exception 'Recurrence recreated purged occurrence'; end if; end $$;
rollback;
