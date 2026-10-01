-- Limpeza inicial do histórico do pg_cron (mantém 7 dias).
delete from cron.job_run_details where start_time < now() - interval '7 days';

-- Retenção diária. Idempotente: substitui o job se já existir.
select cron.unschedule(jobid) from cron.job where jobname = 'cron-run-details-retention';
select cron.schedule(
  'cron-run-details-retention',
  '10 7 * * *',
  $$ delete from cron.job_run_details where start_time < now() - interval '7 days' $$
);
