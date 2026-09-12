alter table manor_private.integration_oauth_states add column return_origin text check(return_origin is null or return_origin ~ '^https?://[^/?#]+$');
-- Old requests have no trusted return origin and expire with an explicit restart error.
create or replace function public.manor_integration_store(p_action text,p_owner uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; state_row manor_private.integration_oauth_states; item jsonb; provider_value text:=p_input->>'provider'; account_value text:=p_input->>'accountId'; added integer:=0; inserted integer;
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
  with due as (select user_id,provider,account_id from manor_private.integration_jobs where run_after<=now() and (leased_until is null or leased_until<now()) order by run_after limit 1 for update skip locked), claimed as (
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
  if provider_value='google' then insert into public.calendar_accounts(user_id,id,email) values(p_owner,account_value,p_input->>'username') on conflict(user_id,id) do update set email=excluded.email; end if;
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
  for item in select value from jsonb_array_elements(p_input->'calendars') loop
   if coalesce((item->>'deleted')::boolean,false) then delete from public.calendars where user_id=p_owner and account_id=account_value and id=item->>'id';
   else insert into public.calendars(user_id,account_id,id,name,color) values(p_owner,account_value,item->>'id',item->>'name',item->>'color') on conflict(user_id,account_id,id) do update set name=excluded.name,color=excluded.color; end if;
  end loop; r:='{"committed":true}';
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
  update manor_private.integration_jobs set leased_until=null,cursor=coalesce((p_input->>'cursor')::integer,cursor),page_token=case when p_input?'pageToken' then p_input->>'pageToken' else page_token end,run_after=now()+case when p_input->>'error' is null then interval '10 minutes' else least(interval '2 hours',interval '30 seconds'*power(2,least(attempts,8))) end,last_error=p_input->>'error',attempts=case when p_input->>'error' is null then 0 else attempts end where user_id=p_owner and provider=provider_value and account_id=account_value; r:='{"committed":true}';
 else raise exception 'Unsupported integration storage operation: %',p_action;
 end case;
 return r;
end $$;
