-- A course calendar feed link (Canvas) saved per account. The link is a credential: it stays in manor_private and is read only by the course-feed function.
create table manor_private.course_feeds (
 user_id uuid primary key references auth.users(id) on delete cascade,
 url text not null, host text not null,
 connected_at timestamptz not null default now(),
 last_checked_at timestamptz, last_item_count integer, last_error text
);
alter table manor_private.course_feeds enable row level security;

create function public.manor_course_feed(p_action text,p_owner uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if p_owner is null then raise exception 'Owner is required'; end if;
 if p_action='read' then
  select jsonb_build_object('url',url,'host',host) into r from manor_private.course_feeds where user_id=p_owner;
  return coalesce(r,'null'::jsonb);
 elsif p_action='connect' then
  insert into manor_private.course_feeds(user_id,url,host,connected_at,last_checked_at,last_item_count,last_error)
  values(p_owner,p_input->>'url',p_input->>'host',now(),now(),(p_input->>'count')::int,null)
  on conflict(user_id) do update set url=excluded.url,host=excluded.host,connected_at=now(),last_checked_at=now(),last_item_count=excluded.last_item_count,last_error=null;
  return 'true'::jsonb;
 elsif p_action='disconnect' then
  delete from manor_private.course_feeds where user_id=p_owner;
  return 'true'::jsonb;
 elsif p_action='checked' then
  update manor_private.course_feeds set last_checked_at=now(),last_item_count=(p_input->>'count')::int,last_error=p_input->>'error' where user_id=p_owner;
  return 'true'::jsonb;
 end if;
 raise exception 'Unsupported course feed action: %',p_action;
end $$;
revoke all on function public.manor_course_feed(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manor_course_feed(text,uuid,jsonb) to service_role;

-- Browser sessions read the connection state with one RPC; the link itself never leaves manor_private.
create function public.manor_course_feed_status() returns jsonb language sql stable security definer set search_path='' as $$
 select case when (select auth.jwt()->>'client_id') is not null then '{"connected":false,"host":null,"connectedAt":null,"lastCheckedAt":null,"lastItemCount":null,"lastError":null}'::jsonb
  else coalesce((select jsonb_build_object('connected',true,'host',f.host,'connectedAt',f.connected_at,'lastCheckedAt',f.last_checked_at,'lastItemCount',f.last_item_count,'lastError',f.last_error)
                 from manor_private.course_feeds f where f.user_id=(select auth.uid())),
                '{"connected":false,"host":null,"connectedAt":null,"lastCheckedAt":null,"lastItemCount":null,"lastError":null}'::jsonb) end;
$$;
revoke all on function public.manor_course_feed_status() from public,anon;
grant execute on function public.manor_course_feed_status() to authenticated;
