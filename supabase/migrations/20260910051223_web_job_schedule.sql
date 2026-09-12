-- Project deployment supplies an own-project HTTPS worker URL and a dedicated worker-only secret.
select cron.schedule('manor-jobs','15 */6 * * *',$job$
 select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='jobs_worker_url'),headers:=jsonb_build_object('Content-Type','application/json','x-manor-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='manor_worker_secret')),body:='{}'::jsonb)
 where exists(select 1 from vault.decrypted_secrets where name='jobs_worker_url') and exists(select 1 from vault.decrypted_secrets where name='manor_worker_secret');
$job$);
