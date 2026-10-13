-- Run and Submit take one database round trip on each side of judging. The Edge Function verifies the caller's JWT
-- locally, so the session it names is checked here, in the transaction that enqueues: a signed-out, expired, or
-- banned session is refused as Auth's user endpoint would refuse it. Each wrapper composes the existing runner
-- actions, so enqueue, lease, completion, and replay rules stay in `manor_problem_runner`.
begin;

create or replace function manor_private.require_live_session(p_owner uuid,p_session uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_session is null or not exists(
  select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_owner and (s.not_after is null or s.not_after>now())
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 ) then raise exception using errcode='PT401',message='Your session expired. Sign in again.'; end if;
end $$;
revoke all on function manor_private.require_live_session(uuid,uuid) from public,anon,authenticated;

-- Enqueues a request and, when it is still queued, leases it in the same transaction. The submission is the owner's
-- read view, with its source; the job is the lease to run inline, or null when the request is a replay of a finished
-- or leased submission.
create or replace function public.manor_problem_execute(p_owner uuid,p_session uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare enqueued jsonb; job jsonb;
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Problem execution is managed by the server'; end if;
 perform manor_private.require_live_session(p_owner,p_session);
 enqueued:=public.manor_problem_runner('enqueue',p_owner,p_input);
 if enqueued->>'status'='queued' then job:=public.manor_problem_runner('claim_submission',p_owner,jsonb_build_object('submissionId',enqueued->>'id')); end if;
 return jsonb_build_object('submission',public.manor_problem_runner('read',p_owner,jsonb_build_object('submissionId',enqueued->>'id')),'job',job);
end $$;
revoke all on function public.manor_problem_execute(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manor_problem_execute(uuid,uuid,jsonb) to service_role;

-- Records a leased batch's outcome and leases the submission's next batch in the same transaction, returning the
-- owner's read view and that lease, or null once the submission is finished or its next batch is not runnable.
create or replace function public.manor_problem_settle(p_action text,p_owner uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare settled jsonb; job jsonb;
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Problem execution is managed by the server'; end if;
 if p_action not in ('complete','fail') then raise exception 'Unknown settle action: %',p_action; end if;
 settled:=public.manor_problem_runner(p_action,p_owner,p_input);
 if settled->>'status' not in ('completed','failed') then job:=public.manor_problem_runner('claim_submission',p_owner,jsonb_build_object('submissionId',settled->>'id')); end if;
 return jsonb_build_object('submission',public.manor_problem_runner('read',p_owner,jsonb_build_object('submissionId',settled->>'id')),'job',job);
end $$;
revoke all on function public.manor_problem_settle(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manor_problem_settle(text,uuid,jsonb) to service_role;

commit;
