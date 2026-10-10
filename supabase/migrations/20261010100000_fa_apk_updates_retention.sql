-- Dispara a edge function uma vez por dia (às 04:30 UTC)
-- para limpar APKs antigos no bucket 'kiosk-updates',
-- mantendo apenas as versões mais recentes.
-- Como os arquivos não têm referência atrelada a banco de dados (são consultados direto no bucket),
-- a lógica inteira de seleção fica isolada na edge function, não precisando de um claim SQL.

do $$
begin
  perform cron.unschedule('fa-kiosk-updates-retention');
exception when others then null;
end $$;

select cron.schedule(
  'fa-kiosk-updates-retention',
  '30 4 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/kiosk-updates-retention-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
