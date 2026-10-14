-- An agent's OAuth flow runs in the agent's own browser window, while the consent decision happens in the
-- Manor app. The app stores the decision's return address here, and the consent bridge page, still open in
-- that window, takes it once and continues there, so the agent receives its callback where it started.
create table manor_private.oauth_handoffs (
 authorization_id text primary key check (length(authorization_id) between 1 and 200),
 redirect_url text not null check (length(redirect_url) between 1 and 4000),
 created_at timestamptz not null default now()
);

-- Only the person who decided, signed in to Manor itself, can store a return address, and only one that goes to
-- the redirect URI the client registered for this authorization, so the bridge can never be sent anywhere else.
create function public.manor_oauth_handoff_save(p_authorization_id text, p_redirect_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare registered text;
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then
  raise exception using errcode = '42501', message = 'Only a signed-in Manor session can hand back an agent connection';
 end if;
 select a.redirect_uri into registered from auth.oauth_authorizations a
  where a.authorization_id = p_authorization_id and (a.user_id is null or a.user_id = auth.uid()) and a.expires_at > now();
 if registered is null then
  raise exception using errcode = 'P0002', message = 'This connection request has expired or belongs to another account';
 end if;
 if p_redirect_url <> registered and left(p_redirect_url, length(registered) + 1) not in (registered || '?', registered || '#') then
  raise exception using errcode = '22023', message = 'The return address does not match the agent''s registered redirect URI';
 end if;
 delete from manor_private.oauth_handoffs where created_at < now() - interval '15 minutes';
 insert into manor_private.oauth_handoffs (authorization_id, redirect_url) values (p_authorization_id, p_redirect_url)
  on conflict (authorization_id) do update set redirect_url = excluded.redirect_url, created_at = now();
end $$;

-- The bridge page knows only the authorization ID from its own address. It receives the return address once;
-- the authorization code inside it is useless without the agent's PKCE verifier.
create function public.manor_oauth_handoff_take(p_authorization_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare taken text;
begin
 delete from manor_private.oauth_handoffs
  where authorization_id = p_authorization_id and created_at > now() - interval '15 minutes'
  returning redirect_url into taken;
 return taken;
end $$;

revoke all on function public.manor_oauth_handoff_save(text, text) from public;
revoke all on function public.manor_oauth_handoff_take(text) from public;
grant execute on function public.manor_oauth_handoff_save(text, text) to authenticated;
grant execute on function public.manor_oauth_handoff_take(text) to anon, authenticated;
