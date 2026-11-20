-- Manor accounts sign in with Apple. A new account still needs the invitation password, but Apple may share a
-- Hide My Email address, so the invitation can't be matched to an email typed in advance. Instead, an Apple sign-in
-- with no invitation is refused with a signed ticket naming the email Apple shared; the app sends that ticket with the
-- invitation password to signup-gate, which grants that email, and the next Apple sign-in goes through. Apple shares
-- the same address with Manor every time, so the grant matches. Existing accounts are unaffected: this hook runs only
-- when Auth creates a user.

-- The key that signs tickets. It never leaves the database.
create table manor_private.signup_ticket_key (
  id boolean primary key default true check (id),
  secret bytea not null
);
alter table manor_private.signup_ticket_key enable row level security;
revoke all on manor_private.signup_ticket_key from public, anon, authenticated;
insert into manor_private.signup_ticket_key (secret) values (extensions.gen_random_bytes(32));

create function manor_private.signup_ticket_signature(p_body text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(convert_to(p_body, 'UTF8'), secret, 'sha256'), 'hex') from manor_private.signup_ticket_key
$$;
revoke all on function manor_private.signup_ticket_signature(text) from public, anon, authenticated;

create or replace function manor_private.before_user_created(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare signup_email text:=lower(event->'user'->>'email'); accepted text; body text;
begin
 -- Auth sets the provider and EmailVerified from Apple's signed identity token before this not-yet-persisted user
 -- reaches the hook. Neither is user-editable metadata.
 if event->'user'->'app_metadata'->>'provider' is distinct from 'apple' or event->'user'->'user_metadata'->>'email_verified' is distinct from 'true' or coalesce(signup_email,'')='' then
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Sign in with Apple to use Manor.'));
 end if;
 update manor_private.signup_grants set consumed_at=clock_timestamp() where signup_grants.email=signup_email and expires_at>clock_timestamp() and consumed_at is null returning signup_grants.email into accepted;
 if accepted is null then
  -- The app reads "invitation_required <ticket>" and asks for the invitation password. The ticket lasts 15 minutes.
  body:=signup_email||'|'||extract(epoch from clock_timestamp()+interval '15 minutes')::bigint;
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
   'invitation_required '||encode(convert_to(body,'UTF8'),'hex')||'.'||manor_private.signup_ticket_signature(body)));
 end if;
 return '{}'::jsonb;
end $$;

-- The email a ticket names, or null when the ticket is forged, malformed, or expired. Called by signup-gate.
create function public.manor_signup_ticket_email(p_ticket text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare body text; bar integer; expires bigint;
begin
  if p_ticket is null or length(p_ticket) > 1200 or p_ticket !~ '^[0-9a-f]+\.[0-9a-f]{64}$' then return null; end if;
  body := convert_from(decode(split_part(p_ticket, '.', 1), 'hex'), 'UTF8');
  if split_part(p_ticket, '.', 2) is distinct from manor_private.signup_ticket_signature(body) then return null; end if;
  bar := length(body) - position('|' in reverse(body)) + 1;
  expires := substr(body, bar + 1)::bigint;
  if expires < extract(epoch from clock_timestamp()) then return null; end if;
  return left(body, bar - 1);
exception when others then
  return null;
end $$;
revoke all on function public.manor_signup_ticket_email(text) from public, anon, authenticated;
grant execute on function public.manor_signup_ticket_email(text) to service_role;
