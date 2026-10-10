-- =====================================================================
-- Notificações do Owner via Telegram
-- =====================================================================
-- Terceiro canal de entrega da fila fa_kiosk_owner_notifications, ao lado
-- do push (sent_at_ms) e do e-mail (emailed_at_ms). Cada canal tem a sua
-- própria marca, então reivindicam a mesma notificação de forma
-- independente — ligar o Telegram não altera push nem e-mail.
--
-- Destino: um chat/grupo único (secrets TELEGRAM_BOT_TOKEN e
-- TELEGRAM_CHAT_ID da Edge Function owner-telegram-dispatch), então não há
-- fan-out por ADMIN como no e-mail.
-- Tipos: todos os que o Owner recebe por push ou e-mail, exceto os
-- ACOMPANHAMENTO_17H/20H, que ficam de fora deste canal por ora.
-- =====================================================================

alter table fa_kiosk_owner_notifications add column if not exists telegram_sent_at_ms bigint;

-- Histórico que já existe não deve virar mensagem retroativa no grupo;
-- só notificações inseridas depois desta migration entram na fila.
update fa_kiosk_owner_notifications
  set telegram_sent_at_ms = (extract(epoch from now()) * 1000)::bigint
  where telegram_sent_at_ms is null;

create or replace function public.fa_owner_telegram_claim_due(p_now_ms bigint)
returns table(notification_id uuid, report_type text, title text, body text, photo_url text, due_at_ms bigint)
language sql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update fa_kiosk_owner_notifications n
  set telegram_sent_at_ms = p_now_ms
  where n.telegram_sent_at_ms is null
    and n.due_at_ms <= p_now_ms
    and n.report_type in (
      'ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_ABERTURA', 'DIVERGENCIA_FECHAMENTO',
      'CANDIDATURA_TALENTOS', 'RESUMO_SEMANAL', 'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA'
    )
  returning n.id, n.report_type, n.title, n.body, n.photo_url, n.due_at_ms;
$function$;

revoke execute on function public.fa_owner_telegram_claim_due(bigint) from public, anon, authenticated;
grant execute on function public.fa_owner_telegram_claim_due(bigint) to service_role;

-- ---------------------------------------------------------------------
-- Cron: dispara a edge function a cada minuto (mesmo padrão e timeout de
-- fa-owner-email-dispatch, 20260829000004).
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('fa-owner-telegram-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'fa-owner-telegram-dispatch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/owner-telegram-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 20000
     ); $$
);
