-- X (Twitter) OAuth connections: one row per Manor user, holding the tokens
-- the x-ingest Edge Function uses to pull bookmarks. RLS is owner-only; the
-- ingest cron runs with the service role, which bypasses RLS.

create table x_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  x_user_id text not null,
  x_username text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now()
);

alter table x_connections enable row level security;

create policy "x_connections_owner" on x_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
