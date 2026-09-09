-- SimplifyJobs internship feed (PRD §7.6): the jobs-ingest Edge Function
-- ETag-polls listings.json and upserts the visible listings here. Listings
-- are shared content (no user_id); each app imports fresh rows into its own
-- job_roles at stage to_apply. Writes go through the service role only.

create table job_listings (
  id text primary key,
  company text not null,
  role text not null,
  locations text not null default '',
  url text not null,
  posted date not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table job_listings enable row level security;

create policy "job_listings_read" on job_listings
  for select to authenticated using (true);

create index job_listings_posted on job_listings (posted desc);

-- Singleton ETag memory for the poll.
create table job_feed_meta (
  id integer primary key check (id = 1),
  etag text,
  fetched_at timestamptz
);

alter table job_feed_meta enable row level security;

insert into job_feed_meta (id, etag, fetched_at) values (1, null, null);

-- Poll four times a day; the ETag makes unchanged runs free.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'jobs-ingest') then
    perform cron.schedule(
      'jobs-ingest',
      '15 */6 * * *',
      $job$
        select net.http_post(
          url := 'https://pxdxqueevzttpmxjsqes.supabase.co/functions/v1/jobs-ingest',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
            )
          ),
          body := '{}'::jsonb
        )
      $job$
    );
  end if;
end
$$;
