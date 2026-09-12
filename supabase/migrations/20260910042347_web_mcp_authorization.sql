create table manor_private.mcp_configuration(singleton boolean primary key check(singleton),resource text not null check(resource like 'https://%'));
create table manor_private.mcp_authorizations(user_id uuid not null references auth.users(id) on delete cascade,client_id uuid not null,can_write boolean not null,authorized_at timestamptz not null default now(),revoked_at timestamptz,primary key(user_id,client_id));
alter table manor_private.mcp_configuration enable row level security;
alter table manor_private.mcp_authorizations enable row level security;
create function manor_private.authorize_mcp_client(p_client_id uuid,p_write boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception using errcode='42501',message='Only a signed-in Manor browser can grant agent access'; end if;
 if p_client_id is null or p_write is null then raise exception 'Choose a client and its access level'; end if;
 insert into manor_private.mcp_authorizations(user_id,client_id,can_write) values(auth.uid(),p_client_id,p_write) on conflict(user_id,client_id) do update set can_write=excluded.can_write,authorized_at=now(),revoked_at=null;
end $$;
create function manor_private.revoke_mcp_client(p_client_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception using errcode='42501',message='Only a signed-in Manor browser can revoke agent access'; end if;
 update manor_private.mcp_authorizations set revoked_at=now() where user_id=auth.uid() and client_id=p_client_id;
end $$;
create function public.manor_authorize_mcp_client(p_client_id uuid,p_write boolean) returns void language sql security invoker set search_path='' as $$ select manor_private.authorize_mcp_client(p_client_id,p_write) $$;
create function public.manor_revoke_mcp_client(p_client_id uuid) returns void language sql security invoker set search_path='' as $$ select manor_private.revoke_mcp_client(p_client_id) $$;
create function manor_private.list_mcp_clients() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception using errcode='42501',message='Only a signed-in Manor browser can list agent connections'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('client_id',client_id,'can_write',can_write,'authorized_at',authorized_at) order by authorized_at desc),'[]') from manor_private.mcp_authorizations where user_id=auth.uid() and revoked_at is null);
end $$;
create function public.manor_list_mcp_clients() returns jsonb language sql stable security invoker set search_path='' as $$ select manor_private.list_mcp_clients() $$;
revoke all on function manor_private.authorize_mcp_client(uuid,boolean),manor_private.revoke_mcp_client(uuid),manor_private.list_mcp_clients(),public.manor_list_mcp_clients() from public,anon;
grant execute on function manor_private.authorize_mcp_client(uuid,boolean),manor_private.revoke_mcp_client(uuid),manor_private.list_mcp_clients(),public.manor_list_mcp_clients() to authenticated;
revoke all on function public.manor_authorize_mcp_client(uuid,boolean),public.manor_revoke_mcp_client(uuid) from public,anon;
grant execute on function public.manor_authorize_mcp_client(uuid,boolean),public.manor_revoke_mcp_client(uuid) to authenticated;
create function manor_private.mcp_allowed(require_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from manor_private.mcp_authorizations where user_id=auth.uid() and client_id=(auth.jwt()->>'client_id')::uuid and revoked_at is null and (not require_write or can_write))
$$;
revoke all on function manor_private.mcp_allowed(boolean) from public;
grant execute on function manor_private.mcp_allowed(boolean) to authenticated,manor_commands;
create function public.manor_mcp_access() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('read',manor_private.mcp_allowed(false),'write',manor_private.mcp_allowed(true))
$$;
revoke all on function public.manor_mcp_access() from public,anon;
grant execute on function public.manor_mcp_access() to authenticated;
create function manor_private.custom_access_token(event jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare client_key uuid:=coalesce(event->>'client_id',event->'claims'->>'client_id')::uuid; permission manor_private.mcp_authorizations; endpoint text; claims jsonb:=event->'claims';
begin
 if client_key is null then return event; end if;
 select * into permission from manor_private.mcp_authorizations where user_id=(event->>'user_id')::uuid and client_id=client_key and revoked_at is null;
 select resource into endpoint from manor_private.mcp_configuration where singleton;
 if permission.user_id is null or endpoint is null then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Approve this agent in Manor before connecting')); end if;
 claims:=jsonb_set(claims,'{aud}',jsonb_build_array('authenticated',endpoint));
 claims:=jsonb_set(claims,'{manor_scope}',to_jsonb(case when permission.can_write then 'manor:read manor:write' else 'manor:read' end));
 return jsonb_set(event,'{claims}',claims);
end $$;
revoke all on function manor_private.custom_access_token(jsonb) from public,anon,authenticated;
grant execute on function manor_private.custom_access_token(jsonb) to supabase_auth_admin;

-- Revocation and read-only grants also apply when a client calls PostgREST directly.
do $policies$
declare t text;
begin
 foreach t in array array['profiles','contexts','tasks','scratch_blocks','saved_task_views','habits','habit_lifecycle','habit_entries','habit_freeze_intents','habit_freeze_usage','habit_freeze_grants','habit_finalized_days','habit_month_pools','mood_focus_entries','leetcode_problems','leetcode_attempts','leetcode_notes','leetcode_freeze_intents','job_roles','job_stage_transitions','note_folders','note_pages','note_attachments','kb_entries','resumes','action_events','note_versions','note_suggestions','weekly_reviews','task_series','file_objects','calendar_accounts','calendars','calendar_events'] loop
  execute format('create policy mcp_read_permission on public.%I as restrictive for select to authenticated using((select auth.jwt()->>''client_id'') is null or (select manor_private.mcp_allowed(false)))',t);
 end loop;
end $policies$;
create policy mcp_storage_write_permission on storage.objects as restrictive for insert to authenticated
 with check((select auth.jwt()->>'client_id') is null or (select manor_private.mcp_allowed(true)));
