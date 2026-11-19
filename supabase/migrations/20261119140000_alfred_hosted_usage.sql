-- Alfred's hosted model access: per-account daily usage, read and written only by the alfred-proxy function with the
-- service role. Rows hold counts and an estimated cost, never request or response content, and go with the account.
create table manor_private.alfred_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_microusd bigint not null default 0,
  listening_sessions integer not null default 0,
  router_requests integer not null default 0,
  primary key (user_id, day)
);
alter table manor_private.alfred_usage enable row level security;
revoke all on manor_private.alfred_usage from public, anon, authenticated;

-- Today's and this month's usage for one account (UTC days), so the proxy can refuse a request past its limits.
create or replace function public.manor_alfred_usage(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'day_cost_microusd', coalesce(sum(cost_microusd) filter (where day = (now() at time zone 'utc')::date), 0),
    'day_listening_sessions', coalesce(sum(listening_sessions) filter (where day = (now() at time zone 'utc')::date), 0),
    'day_router_requests', coalesce(sum(router_requests) filter (where day = (now() at time zone 'utc')::date), 0),
    'month_cost_microusd', coalesce(sum(cost_microusd), 0)
  )
  from manor_private.alfred_usage
  where user_id = p_owner and day >= date_trunc('month', now() at time zone 'utc')::date
$$;

-- Adds one request's usage to today's row. Rows older than about 13 months are dropped on the way.
create or replace function public.manor_alfred_record(p_owner uuid, p_input jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into manor_private.alfred_usage as u (user_id, day, requests, input_tokens, output_tokens, cost_microusd, listening_sessions, router_requests)
  values (
    p_owner, (now() at time zone 'utc')::date,
    coalesce((p_input->>'requests')::integer, 0), coalesce((p_input->>'input_tokens')::bigint, 0),
    coalesce((p_input->>'output_tokens')::bigint, 0), coalesce((p_input->>'cost_microusd')::bigint, 0),
    coalesce((p_input->>'listening_sessions')::integer, 0), coalesce((p_input->>'router_requests')::integer, 0)
  )
  on conflict (user_id, day) do update set
    requests = u.requests + excluded.requests,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cost_microusd = u.cost_microusd + excluded.cost_microusd,
    listening_sessions = u.listening_sessions + excluded.listening_sessions,
    router_requests = u.router_requests + excluded.router_requests;
  delete from manor_private.alfred_usage where user_id = p_owner and day < (now() at time zone 'utc')::date - 400;
end;
$$;

revoke all on function public.manor_alfred_usage(uuid) from public, anon, authenticated;
revoke all on function public.manor_alfred_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.manor_alfred_usage(uuid) to service_role;
grant execute on function public.manor_alfred_record(uuid, jsonb) to service_role;
