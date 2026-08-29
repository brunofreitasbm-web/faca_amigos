-- =====================================================================
-- Notificação por e-mail (Abertura/Fechamento de caixa)
-- =====================================================================
-- Estende a fila fa_kiosk_owner_notifications (20260818000001) com um
-- segundo canal de entrega, independente do push: e-mail via Gmail SMTP,
-- remetente fixo hub.operacao.lojas@gmail.com (credenciais já cadastradas
-- como secrets GMAIL_USER/GMAIL_APP_PASSWORD nas Edge Functions do
-- projeto). Só ABERTURA e FECHAMENTO disparam e-mail — os demais tipos de
-- relatório continuam só push.
--
-- emailed_at_ms é uma coluna própria (não reaproveita sent_at_ms, que já
-- é a marca de "reivindicado pelo push") para os dois canais reivindicarem
-- a mesma notificação de forma independente.
-- =====================================================================

alter table fa_kiosk_owner_notifications add column if not exists emailed_at_ms bigint;

-- Notificações que já existiam antes deste canal existir não devem
-- disparar e-mail retroativo — marca tudo que já está na fila como "já
-- tratado" no canal de e-mail; só notificações novas (INSERT após esta
-- migration) ficam com emailed_at_ms null e entram na fila de envio.
update fa_kiosk_owner_notifications
  set emailed_at_ms = (extract(epoch from now()) * 1000)::bigint
  where emailed_at_ms is null;

-- ---------------------------------------------------------------------
-- Reivindicação atômica das notificações de Abertura/Fechamento pendentes
-- de e-mail + fan-out para todo ADMIN (Owner) com e-mail cadastrado.
-- ---------------------------------------------------------------------
create or replace function fa_owner_email_claim_due(p_now_ms bigint) returns table (
  notification_id uuid, title text, body text, recipient_email text
) as $$
  with due as (
    update fa_kiosk_owner_notifications
    set emailed_at_ms = p_now_ms
    where emailed_at_ms is null
      and due_at_ms <= p_now_ms
      and report_type in ('ABERTURA', 'FECHAMENTO')
    returning id, title, body
  )
  select d.id, d.title, d.body, e.email
  from due d
  cross join fa_kiosk_employees e
  where e.role = 'ADMIN' and e.email is not null and length(trim(e.email)) > 0;
$$ language sql volatile security definer;

revoke execute on function fa_owner_email_claim_due(bigint) from public;
grant execute on function fa_owner_email_claim_due(bigint) to service_role;

-- ---------------------------------------------------------------------
-- Cron: dispara a edge function de envio de e-mail a cada minuto (mesmo
-- padrão de fa-owner-report-dispatch, canal separado).
-- ---------------------------------------------------------------------
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
       body := '{}'::jsonb
     ); $$
);
