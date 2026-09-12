-- Direct database maintenance has no external callback or credential transport.
select cron.schedule('manor-maintenance','17 * * * *','select public.manor_run_maintenance();');
