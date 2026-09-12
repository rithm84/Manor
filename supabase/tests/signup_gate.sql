begin;
do $$
declare event jsonb:='{"user":{"email":"gate-test@example.invalid","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}'; r jsonb;
begin
 r:=manor_private.before_user_created(event);
 if not r?'error' then raise exception 'Direct signup bypassed the gate'; end if;
 perform public.manor_issue_signup_grant('gate-test@example.invalid');
 r:=manor_private.before_user_created(jsonb_set(event,'{user,email}','"mismatch@example.invalid"'));
 if not r?'error' then raise exception 'Mismatched email used the grant'; end if;
 r:=manor_private.before_user_created(jsonb_set(event,'{user,app_metadata,provider}','"email"'));
 if not r?'error' then raise exception 'Email provider bypassed Google-only restriction'; end if;
 r:=manor_private.before_user_created(jsonb_set(event,'{user,user_metadata,email_verified}','false'));
 if not r?'error' then raise exception 'Unverified Google email was accepted'; end if;
 r:=manor_private.before_user_created(event);
 if r?'error' then raise exception 'Valid grant was rejected: %',r; end if;
 r:=manor_private.before_user_created(event);
 if not r?'error' then raise exception 'Signup grant was reusable'; end if;
 perform public.manor_issue_signup_grant('gate-test@example.invalid');
 update manor_private.signup_grants set expires_at=now()-interval '1 minute' where email='gate-test@example.invalid';
 r:=manor_private.before_user_created(event);
 if not r?'error' then raise exception 'Expired grant was accepted'; end if;
end $$;
rollback;
