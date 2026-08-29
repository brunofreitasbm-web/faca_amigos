-- fa-owner-email-dispatch (20260829000003) usava o timeout padrão do
-- net.http_post (5s do pg_net) — insuficiente para o handshake TLS com
-- smtp.gmail.com via nodemailer, especialmente em cold start da function
-- (resolução do módulo npm:nodemailer + handshake). Confirmado em teste
-- real: net._http_response.timed_out = true, "Timeout of 5000 ms reached"
-- — a function nem chegava a responder. Reagenda com timeout maior.
do $$
begin
  perform cron.unschedule('fa-owner-email-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'fa-owner-email-dispatch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/owner-email-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 20000
     ); $$
);
