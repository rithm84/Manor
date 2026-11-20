begin;
do $$
declare event jsonb:='{"user":{"email":"gate-test@example.invalid","app_metadata":{"provider":"apple"},"user_metadata":{"email_verified":true}}}'; r jsonb; ticket text; body text;
begin
 -- Without an invitation, an Apple sign-in is refused with a ticket naming its email.
 r:=manor_private.before_user_created(event);
 if not r?'error' or r->'error'->>'message' not like 'invitation_required %' then raise exception 'Uninvited signup was not refused with a ticket: %',r; end if;
 ticket:=substr(r->'error'->>'message',length('invitation_required ')+1);
 if public.manor_signup_ticket_email(ticket) is distinct from 'gate-test@example.invalid' then raise exception 'Ticket did not name its email'; end if;
 if public.manor_signup_ticket_email(overlay(ticket placing (case when right(ticket,1)='0' then '1' else '0' end) from length(ticket))) is not null then raise exception 'A tampered ticket was accepted'; end if;
 body:='gate-test@example.invalid|'||(extract(epoch from now())::bigint-1);
 if public.manor_signup_ticket_email(encode(convert_to(body,'UTF8'),'hex')||'.'||manor_private.signup_ticket_signature(body)) is not null then raise exception 'An expired ticket was accepted'; end if;
 if public.manor_signup_ticket_email('not a ticket') is not null then raise exception 'A malformed ticket was accepted'; end if;
 -- Other providers and unverified emails are refused outright, with no ticket.
 r:=manor_private.before_user_created(jsonb_set(event,'{user,app_metadata,provider}','"google"'));
 if r->'error'->>'message' like 'invitation_required %' then raise exception 'Google sign-up got a ticket'; end if;
 r:=manor_private.before_user_created(jsonb_set(event,'{user,app_metadata,provider}','"email"'));
 if not r?'error' or r->'error'->>'message' like 'invitation_required %' then raise exception 'Email provider bypassed the Apple-only restriction'; end if;
 r:=manor_private.before_user_created(jsonb_set(event,'{user,user_metadata,email_verified}','false'));
 if not r?'error' or r->'error'->>'message' like 'invitation_required %' then raise exception 'Unverified Apple email was accepted'; end if;
 -- A grant lets exactly that email in, once.
 perform public.manor_issue_signup_grant('gate-test@example.invalid');
 r:=manor_private.before_user_created(jsonb_set(event,'{user,email}','"mismatch@example.invalid"'));
 if not r?'error' then raise exception 'Mismatched email used the grant'; end if;
 r:=manor_private.before_user_created(event);
 if r?'error' then raise exception 'Valid grant was rejected: %',r; end if;
 r:=manor_private.before_user_created(event);
 if not r?'error' then raise exception 'Signup grant was reusable'; end if;
 -- A Hide My Email address works the same way.
 perform public.manor_issue_signup_grant('abc123@privaterelay.appleid.com');
 r:=manor_private.before_user_created(jsonb_set(event,'{user,email}','"abc123@privaterelay.appleid.com"'));
 if r?'error' then raise exception 'A granted Hide My Email address was rejected: %',r; end if;
 perform public.manor_issue_signup_grant('gate-test@example.invalid');
 update manor_private.signup_grants set expires_at=now()-interval '1 minute' where email='gate-test@example.invalid';
 r:=manor_private.before_user_created(event);
 if r->'error'->>'message' not like 'invitation_required %' then raise exception 'Expired grant was accepted'; end if;
end $$;
rollback;
