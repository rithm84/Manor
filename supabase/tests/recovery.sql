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
-- Synthetic byte envelopes exercise lifecycle only; browser WebCrypto tests cover real authentication.
set local role authenticated;
select public.journal_save_keyring(jsonb_build_object('version',1,'kdf','PBKDF2-SHA256','iterations',600000,'salt',encode(decode(repeat('01',32),'hex'),'base64'),'nonce',encode(decode(repeat('02',12),'hex'),'base64'),'wrappedKey',encode(decode(repeat('03',48),'hex'),'base64')),0);
select public.journal_save_entry('2026-09-08',jsonb_build_object('version',1,'nonce',encode(decode(repeat('04',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('05',32),'hex'),'base64')),0);
select public.journal_save_entry('2026-09-09',jsonb_build_object('version',1,'nonce',encode(decode(repeat('06',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('07',32),'hex'),'base64')),0);
select public.journal_delete_entry('2026-09-08',1,true);
select public.journal_delete_entry('2026-09-09',1,true);
do $$begin
 if exists(select 1 from jsonb_array_elements(public.journal_read_state()->'entries') entry where entry->'envelope'<>'null'::jsonb) then raise exception 'Deleted Journal ciphertext remained visible'; end if;
end $$;
reset role;
do $$begin
 if (select count(*) from journal_private.entries where user_id='55555555-5555-4555-8555-555555555555' and envelope is not null and deleted_at is not null)<>2 then raise exception 'Journal bytes removed before independent ledger checkpoint'; end if;
end $$;
select public.manor_acknowledge_recovery(repeat('b',64),(select jsonb_agg(to_jsonb(t)) from manor_private.purge_tombstones t where user_id='55555555-5555-4555-8555-555555555555'));
do $$begin
 if exists(select 1 from journal_private.entries where user_id='55555555-5555-4555-8555-555555555555' and envelope is not null) then raise exception 'Acknowledged Journal bytes remained'; end if;
end $$;
set local role authenticated;
select public.journal_save_entry('2026-09-09',jsonb_build_object('version',1,'nonce',encode(decode(repeat('08',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('09',32),'hex'),'base64')),2);
reset role;
-- Simulate an old database snapshot resurrecting the other deleted day's ciphertext.
update journal_private.entries set revision=1,deleted_at=null,envelope=jsonb_build_object('version',1,'nonce',encode(decode(repeat('04',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('05',32),'hex'),'base64')) where user_id='55555555-5555-4555-8555-555555555555' and date='2026-09-08';
select set_config('manor.recovery_isolated','yes',true);
select public.manor_reconcile_recovery((select jsonb_agg(to_jsonb(t)) from manor_private.purge_tombstones t where user_id='55555555-5555-4555-8555-555555555555'));
do $$begin
 if exists(select 1 from journal_private.entries where user_id='55555555-5555-4555-8555-555555555555' and date='2026-09-08' and (envelope is not null or revision<>2)) then raise exception 'Restore resurrected a deleted Journal revision'; end if;
 if not exists(select 1 from journal_private.entries where user_id='55555555-5555-4555-8555-555555555555' and date='2026-09-09' and envelope is not null and revision=3 and deleted_at is null) then raise exception 'Old Journal tombstone destroyed a newer written day'; end if;
end $$;
rollback;
