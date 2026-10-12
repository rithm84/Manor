-- Deployment supplies this project's runner URL and dedicated worker secret in Vault.
select cron.schedule('manor-problem-runner','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='problem_runner_url'),
  headers:=jsonb_build_object('Content-Type','application/json','x-manor-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='manor_worker_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=120000
 ) where exists(select 1 from vault.decrypted_secrets where name='problem_runner_url')
   and exists(select 1 from vault.decrypted_secrets where name='manor_worker_secret');
$job$);
