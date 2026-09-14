-- The desktop app keeps a local mirror of the account's rows and replicates it from the workspace change
-- feed: it reads the head cursor once at bootstrap, then pulls the rows committed after the cursor it last
-- recorded. The feed carries identities and revisions only, never content, so a pull tells the app which
-- rows to re-read and exposes nothing beyond that. Reading the mirror is a first-party application
-- capability, not an agent tool: MCP-scoped tokens keep using the get_changes_since workspace tool.
create function public.manor_workspace_cursor() returns bigint language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if (select auth.jwt()->>'client_id') is not null then raise exception using errcode='42501',message='The Manor mirror is a first-party application capability. Read account changes with the get_changes_since workspace tool instead.'; end if;
 return coalesce((select h.cursor from manor_private.workspace_change_heads h where h.user_id=(select auth.uid())),0);
end $$;

create function public.manor_workspace_changes(p_since bigint,p_limit integer)
 returns table(cursor bigint,object_type text,object_key jsonb,change text,revision bigint,occurred_at timestamptz)
 language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in before reading Manor'; end if;
 if (select auth.jwt()->>'client_id') is not null then raise exception using errcode='42501',message='The Manor mirror is a first-party application capability. Read account changes with the get_changes_since workspace tool instead.'; end if;
 if p_since is null or p_since<0 then raise exception using errcode='22023',message='Pull Manor changes from cursor 0 or the last cursor the mirror recorded, not '||coalesce(p_since::text,'null'); end if;
 if p_limit is null then raise exception using errcode='22023',message='Pulling Manor changes requires a row limit; it is clamped to 1 through 1000'; end if;
 return query select c.cursor,c.object_type,c.object_key,c.change,c.revision,c.occurred_at
  from manor_private.workspace_changes c where c.user_id=(select auth.uid()) and c.cursor>p_since
  order by c.cursor limit least(greatest(p_limit,1),1000);
end $$;

-- Both read manor_private tables whose only policies grant the command role, so they run as its owner.
grant create on schema public to manor_commands;
alter function public.manor_workspace_cursor() owner to manor_commands;
alter function public.manor_workspace_changes(bigint,integer) owner to manor_commands;
revoke create on schema public from manor_commands;
revoke all on function public.manor_workspace_cursor(),public.manor_workspace_changes(bigint,integer) from public,anon;
grant execute on function public.manor_workspace_cursor(),public.manor_workspace_changes(bigint,integer) to authenticated;
