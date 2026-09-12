-- Serialize calendar additions per Manor owner, including concurrent account connections.
create function manor_private.enforce_calendar_limit() returns trigger
language plpgsql set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=new.user_id for update;
 if not exists(select 1 from public.calendars where user_id=new.user_id and account_id=new.account_id and id=new.id)
    and (select count(*) from public.calendars where user_id=new.user_id)>=12 then
  raise exception 'Manor supports up to 12 calendars across all Google accounts. Disconnect an account or remove calendars from its Google Calendar list before connecting or syncing more.' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function manor_private.enforce_calendar_limit() from public,anon,authenticated;
create trigger calendar_limit before insert on public.calendars
for each row execute function manor_private.enforce_calendar_limit();

-- Claim a bounded account batch each cron tick; Google resumes at the next minute boundary.
-- Connections that would exceed twelve calendars are rejected; calendars appearing later beyond the cap are skipped so connected calendars keep syncing.
create or replace function public.manor_integration_store(p_action text,p_owner uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; state_row manor_private.integration_oauth_states; item jsonb; provider_value text:=p_input->>'provider'; account_value text:=p_input->>'accountId'; added integer:=0; inserted integer; skipped integer:=0;
begin
 if p_action='oauth_lookup' then
  select jsonb_build_object('provider',provider,'return_origin',return_origin) into r from manor_private.integration_oauth_states where state_hash=p_input->>'stateHash' and expires_at>now();
  if r is null or r->>'return_origin' is null then raise exception 'Connection request expired; start it again'; end if; return r;
 end if;
 if p_action='oauth_consume' then
  delete from manor_private.integration_oauth_states where state_hash=p_input->>'stateHash' and user_id=p_owner and verifier=p_input->>'challenge' and expires_at>now() returning * into state_row;
  if state_row.state_hash is null then raise exception 'Connection request expired or was already used'; end if;
  return to_jsonb(state_row);
 end if;
 if p_action='claim_jobs' then
  with due as (select user_id,provider,account_id from manor_private.integration_jobs where run_after<=now() and (leased_until is null or leased_until<now()) order by run_after limit 16 for update skip locked), claimed as (
   update manor_private.integration_jobs j set leased_until=now()+interval '2 minutes',attempts=attempts+1 from due d where j.user_id=d.user_id and j.provider=d.provider and j.account_id=d.account_id returning j.*)
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into r from claimed; return r;
 end if;
 if p_owner is null then raise exception 'An integration owner is required'; end if;
 case p_action
 when 'oauth_start' then
  delete from manor_private.integration_oauth_states where expires_at<now();
  if p_input->>'returnOrigin' is null or p_input->>'returnOrigin' !~ '^https?://[^/?#]+$' then raise exception 'A validated application return origin is required'; end if;
  insert into manor_private.integration_oauth_states(state_hash,user_id,provider,verifier,expires_at,return_origin) values(p_input->>'stateHash',p_owner,provider_value,p_input->>'verifier',now()+interval '10 minutes',p_input->>'returnOrigin'); r:='{}';
 when 'connect' then
  if provider_value='x' then delete from manor_private.integration_credentials where user_id=p_owner and provider='x' and account_id<>account_value; end if;
  insert into manor_private.integration_credentials(user_id,provider,account_id,access_token,refresh_token,expires_at,username)
   values(p_owner,provider_value,account_value,p_input->>'accessToken',p_input->>'refreshToken',(p_input->>'expiresAt')::timestamptz,p_input->>'username')
   on conflict(user_id,provider,account_id) do update set access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,username=excluded.username;
  if provider_value='google' then
   if jsonb_typeof(p_input->'calendars') is distinct from 'array' then raise exception 'Google connection requires its calendar list'; end if;
   perform 1 from public.profiles where user_id=p_owner for update;
   if (select count(*) from public.calendars where user_id=p_owner and account_id<>account_value)
      +(select count(*) from jsonb_array_elements(p_input->'calendars') c where not coalesce((c->>'deleted')::boolean,false))>12 then
    raise exception 'Manor supports up to 12 calendars across all Google accounts. Remove calendars from this Google account or disconnect another account before connecting it.' using errcode='23514';
   end if;
   insert into public.calendar_accounts(user_id,id,email) values(p_owner,account_value,p_input->>'username') on conflict(user_id,id) do update set email=excluded.email;
   perform public.manor_integration_store('calendar_list',p_owner,jsonb_build_object('accountId',account_value,'calendars',p_input->'calendars'));
  end if;
  insert into manor_private.integration_jobs(user_id,provider,account_id) values(p_owner,provider_value,account_value) on conflict(user_id,provider,account_id) do update set run_after=now(),last_error=null;
  r:='{"committed":true}';
 when 'credentials' then
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into r from manor_private.integration_credentials c where user_id=p_owner and provider=provider_value and (account_value is null or account_id=account_value);
 when 'refresh' then
  update manor_private.integration_credentials set access_token=p_input->>'accessToken',refresh_token=coalesce(p_input->>'refreshToken',refresh_token),expires_at=(p_input->>'expiresAt')::timestamptz where user_id=p_owner and provider=provider_value and account_id=account_value;
  r:='{"committed":true}';
 when 'disconnect' then
  delete from manor_private.integration_credentials where user_id=p_owner and provider=provider_value and (account_value is null or account_id=account_value);
  delete from manor_private.integration_jobs where user_id=p_owner and provider=provider_value and (account_value is null or account_id=account_value);
  if provider_value='google' then delete from public.calendar_accounts where user_id=p_owner and id=account_value;
  else delete from public.x_connections where user_id=p_owner; end if; r:='{"committed":true}';
 when 'calendar_list' then
  perform 1 from public.profiles where user_id=p_owner for update;
  for item in select value from jsonb_array_elements(p_input->'calendars') loop
   if coalesce((item->>'deleted')::boolean,false) then delete from public.calendars where user_id=p_owner and account_id=account_value and id=item->>'id';
   elsif exists(select 1 from public.calendars where user_id=p_owner and account_id=account_value and id=item->>'id') then
    update public.calendars set name=item->>'name',color=item->>'color' where user_id=p_owner and account_id=account_value and id=item->>'id';
   elsif (select count(*) from public.calendars where user_id=p_owner)>=12 then skipped:=skipped+1;
   else insert into public.calendars(user_id,account_id,id,name,color) values(p_owner,account_value,item->>'id',item->>'name',item->>'color'); end if;
  end loop; r:=jsonb_build_object('committed',true,'skipped',skipped);
 when 'calendar_state' then
  select to_jsonb(s) into r from manor_private.calendar_sync_states s where user_id=p_owner and account_id=account_value and calendar_id=p_input->>'calendarId';
  r:=coalesce(r,'{}');
 when 'calendar_reset' then
  delete from public.calendar_events where user_id=p_owner and account_id=account_value and calendar_id=p_input->>'calendarId';
  delete from manor_private.calendar_sync_states where user_id=p_owner and account_id=account_value and calendar_id=p_input->>'calendarId'; r:='{"committed":true}';
 when 'calendar_page' then
  for item in select value from jsonb_array_elements(p_input->'events') loop
   if item->>'status'='cancelled' then delete from public.calendar_events where user_id=p_owner and account_id=account_value and calendar_id=p_input->>'calendarId' and id=item->>'id';
   else insert into public.calendar_events(user_id,account_id,calendar_id,id,title,starts_at,ends_at,start_date,end_date,all_day)
    values(p_owner,account_value,p_input->>'calendarId',item->>'id',coalesce(item->>'summary','Untitled event'),(item->'start'->>'dateTime')::timestamptz,(item->'end'->>'dateTime')::timestamptz,(item->'start'->>'date')::date,(item->'end'->>'date')::date,(item->'start'?'date'))
    on conflict(user_id,account_id,calendar_id,id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,end_date=excluded.end_date,all_day=excluded.all_day;
   end if;
  end loop;
  insert into manor_private.calendar_sync_states(user_id,account_id,calendar_id,sync_token,page_token,window_start,window_end) values(p_owner,account_value,p_input->>'calendarId',p_input->>'syncToken',p_input->>'pageToken',(p_input->>'windowStart')::timestamptz,(p_input->>'windowEnd')::timestamptz) on conflict(user_id,account_id,calendar_id) do update set sync_token=excluded.sync_token,page_token=excluded.page_token;
  r:='{"committed":true}';
 when 'visibility' then
  update public.calendars set enabled=(p_input->>'enabled')::boolean where user_id=p_owner and account_id=account_value and id=p_input->>'calendarId';
  if not found then raise exception 'Calendar is unavailable'; end if; r:='{"committed":true}';
 when 'claim_job' then
  update manor_private.integration_jobs set leased_until=now()+interval '2 minutes',attempts=attempts+1 where user_id=p_owner and provider=provider_value and account_id=account_value and (leased_until is null or leased_until<now()) returning to_jsonb(integration_jobs) into r;
  if r is null then raise exception 'This connection is already syncing. Try again shortly.' using errcode='55000'; end if;
 when 'job_state' then
  select to_jsonb(j) into r from manor_private.integration_jobs j where user_id=p_owner and provider=provider_value and account_id=account_value; r:=coalesce(r,'{}');
 when 'x_page' then
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','sync_x_bookmarks',true);
  perform set_config('manor.actor','background',true);
  for item in select value from jsonb_array_elements(p_input->'entries') loop
   insert into public.kb_entries(user_id,source,source_ref,url,title,author,content_md,raw,status,captured_at)
    values(p_owner,'x_bookmark',item->>'source_ref',item->>'url',item->>'title',item->>'author',item->>'content_md',item->'raw',item->>'status',(item->>'captured_at')::timestamptz)
    on conflict(user_id,source_ref) where source_ref is not null do nothing;
   get diagnostics inserted=row_count; added:=added+inserted;
  end loop; r:=jsonb_build_object('added',added);
 when 'job_result' then
  update manor_private.integration_jobs set leased_until=null,cursor=coalesce((p_input->>'cursor')::integer,cursor),page_token=case when p_input?'pageToken' then p_input->>'pageToken' else page_token end,run_after=case when p_input->>'error' is not null then now()+least(interval '2 hours',interval '30 seconds'*power(2,least(attempts,8))) when provider_value='google' then date_trunc('minute',now())+interval '1 minute' else now()+interval '10 minutes' end,last_error=p_input->>'error',attempts=case when p_input->>'error' is null then 0 else attempts end where user_id=p_owner and provider=provider_value and account_id=account_value; r:='{"committed":true}';
 else raise exception 'Unsupported integration storage operation: %',p_action;
 end case;
 return r;
end $$;

-- Make healthy Google jobs eligible at the next existing cron tick.
update manor_private.integration_jobs set run_after=now()
where provider='google' and last_error is null and (leased_until is null or leased_until<now());
