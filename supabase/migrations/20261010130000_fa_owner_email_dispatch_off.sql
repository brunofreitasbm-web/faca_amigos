-- Owner passa a receber as notificações só pelo Telegram (owner-telegram-dispatch,
-- 20261010120000) e pelo push. Desliga o cron do canal de e-mail.
--
-- A function owner-email-dispatch e fa_owner_email_claim_due continuam no
-- projeto: para voltar o e-mail, basta reagendar o cron (ver
-- 20260829000004_fa_owner_email_dispatch_timeout.sql).
--
-- Atenção ao religar: enquanto o cron está desligado, as notificações novas
-- continuam entrando na fila com emailed_at_ms nulo, e a primeira rodada
-- depois de religar mandaria todo esse acúmulo de uma vez. Antes de religar,
-- marque o que já passou:
--   update fa_kiosk_owner_notifications
--     set emailed_at_ms = (extract(epoch from now()) * 1000)::bigint
--     where emailed_at_ms is null;
do $$
begin
  perform cron.unschedule('fa-owner-email-dispatch');
exception when others then null;
end $$;
