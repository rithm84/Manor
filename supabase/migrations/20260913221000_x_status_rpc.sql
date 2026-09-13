-- Browser sessions read the X connection state with one RPC instead of an Edge Function round trip; tokens never leave manor_private.
create function public.manor_x_status() returns jsonb language sql stable security definer set search_path='' as $$
 select case when (select auth.jwt()->>'client_id') is not null then '{"connected":false,"username":null,"connectedAt":null}'::jsonb
  else coalesce((select jsonb_build_object('connected',true,'username',c.username,'connectedAt',c.connected_at)
                 from manor_private.integration_credentials c where c.user_id=(select auth.uid()) and c.provider='x' order by c.connected_at desc limit 1),
                '{"connected":false,"username":null,"connectedAt":null}'::jsonb) end;
$$;
revoke all on function public.manor_x_status() from public,anon;
grant execute on function public.manor_x_status() to authenticated;
