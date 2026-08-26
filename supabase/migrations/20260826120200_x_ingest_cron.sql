-- Schedules the x-ingest Edge Function every 20 minutes via pg_cron + pg_net.
-- The job authenticates with the service role so it can iterate every
-- x_connections row. Requires the Vault secret named 'service_role_key'
-- (seeded at deploy time by the orchestrator) to exist before the first run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'x-ingest') then
    perform cron.schedule(
      'x-ingest',
      '*/20 * * * *',
      $job$
        select net.http_post(
          url := 'https://pxdxqueevzttpmxjsqes.supabase.co/functions/v1/x-ingest',
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
