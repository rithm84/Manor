-- Run after migrations in a transaction and always roll back these test writes.
begin;
do $$
declare owner uuid; acct text; current_count int; i int; next_run timestamptz; existing_id text; listed jsonb;
begin
 select user_id,id into owner,acct from public.calendar_accounts order by connected_at limit 1;
 if owner is null then raise exception 'Requires a connected staging Google account'; end if;
 select count(*) into current_count from public.calendars where user_id=owner;
 for i in current_count+1..12 loop
  insert into public.calendars(user_id,account_id,id,name) values(owner,acct,'minute-check-'||i,'Minute sync verification');
 end loop;
 begin
  insert into public.calendars(user_id,account_id,id,name) values(owner,acct,'minute-check-over-limit','Over limit');
  raise exception 'Thirteenth calendar was incorrectly allowed';
 exception when check_violation then null;
 end;
 insert into public.calendars(user_id,account_id,id,name)
 select user_id,account_id,id,name from public.calendars where user_id=owner limit 1
 on conflict(user_id,account_id,id) do update set name=excluded.name;
 select id into existing_id from public.calendars where user_id=owner and account_id=acct order by id limit 1;
 listed:=public.manor_integration_store('calendar_list',owner,jsonb_build_object('accountId',acct,'calendars',jsonb_build_array(
  jsonb_build_object('id',existing_id,'name','Renamed by sync'),
  jsonb_build_object('id','minute-check-over-limit','name','Over limit'))));
 if (listed->>'skipped')::int<>1 then raise exception 'Sync did not report the skipped over-limit calendar'; end if;
 if exists(select 1 from public.calendars where user_id=owner and id='minute-check-over-limit') then raise exception 'Sync added a calendar beyond the limit'; end if;
 if not exists(select 1 from public.calendars where user_id=owner and account_id=acct and id=existing_id and name='Renamed by sync') then raise exception 'Sync stopped updating connected calendars at the limit'; end if;
 begin
  perform public.manor_integration_store('connect',owner,jsonb_build_object(
   'provider','google','accountId','minute-check-new-account','username','test@example.invalid',
   'accessToken','test','refreshToken','test','expiresAt',now()+interval '1 hour',
   'calendars',jsonb_build_array(jsonb_build_object('id','new-calendar','name','New calendar'))));
  raise exception 'Over-limit connection was incorrectly allowed';
 exception when check_violation then null;
 end;
 if exists(select 1 from public.calendar_accounts where user_id=owner and id='minute-check-new-account')
    or exists(select 1 from manor_private.integration_credentials where user_id=owner and account_id='minute-check-new-account') then
  raise exception 'Rejected connection left partial data';
 end if;
 perform public.manor_integration_store('job_result',owner,jsonb_build_object('provider','google','accountId',acct,'cursor',0,'error',null));
 select run_after into next_run from manor_private.integration_jobs where user_id=owner and provider='google' and account_id=acct;
 if next_run is distinct from date_trunc('minute',now())+interval '1 minute' then raise exception 'Google cadence is not next minute'; end if;
 update manor_private.integration_jobs set leased_until=null,run_after=now() where user_id=owner;
 for i in 1..11 loop
  insert into manor_private.integration_jobs(user_id,provider,account_id) values(owner,'google','minute-check-'||i);
 end loop;
 if jsonb_array_length(public.manor_integration_store('claim_jobs',null,'{}'))<12 then
  raise exception 'Worker did not claim multiple Google accounts together';
 end if;
end $$;
rollback;
