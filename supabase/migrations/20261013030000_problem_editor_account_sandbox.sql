-- One resumable editor sandbox per account serves every problem and language. Its lease is renewed by each editor
-- request and follows the open problem, so an active editor still protects that problem from grouping; a lease
-- renewed only for prewarming has no problem. Per-problem leases from earlier sessions become stale and the server
-- deletes them in the background; the minute cleanup still removes every expired lease and its sandbox.
begin;

alter table manor_private.problem_editor_sessions alter column problem_id drop not null;
alter table manor_private.problem_editor_sessions add column account_sandbox boolean not null default false;
create unique index problem_editor_sessions_account_sandbox on manor_private.problem_editor_sessions(user_id) where account_sandbox;

drop trigger problem_canonical_practice on manor_private.problem_editor_sessions;
create trigger problem_canonical_practice before insert or update on manor_private.problem_editor_sessions for each row when (new.problem_id is not null) execute function manor_private.guard_problem_practice_target();

create function public.manor_problem_editor_lease(p_owner uuid,p_problem_id text,p_language text,p_idle_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare lease manor_private.problem_editor_sessions; stale jsonb;
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Editor leases are managed by the server'; end if;
 if p_owner is null or p_language is null or p_idle_seconds is null or p_idle_seconds not between 300 and 7200 then raise exception 'An editor lease requires an account, a language, and an idle window between 5 and 120 minutes'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'problem-editors',0));
 -- An expired account lease may already be in the minute cleanup, so it is never revived.
 update manor_private.problem_editor_sessions set account_sandbox=false where user_id=p_owner and account_sandbox and expires_at<=clock_timestamp();
 update manor_private.problem_editor_sessions set problem_id=coalesce(p_problem_id,problem_id),language=p_language,expires_at=clock_timestamp()+make_interval(secs=>p_idle_seconds) where user_id=p_owner and account_sandbox returning * into lease;
 if not found then
  insert into manor_private.problem_editor_sessions(user_id,id,problem_id,language,sandbox_name,expires_at,account_sandbox)
  values(p_owner,gen_random_uuid(),p_problem_id,p_language,'manor-editor-'||replace(gen_random_uuid()::text,'-',''),clock_timestamp()+make_interval(secs=>p_idle_seconds),true) returning * into lease;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sandboxName',sandbox_name)),'[]'::jsonb) into stale from manor_private.problem_editor_sessions where user_id=p_owner and not account_sandbox;
 return jsonb_build_object('id',lease.id,'sandboxName',lease.sandbox_name,'expiresAt',lease.expires_at,'stale',stale);
end $$;
revoke all on function public.manor_problem_editor_lease(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.manor_problem_editor_lease(uuid,text,text,integer) to service_role;

commit;
