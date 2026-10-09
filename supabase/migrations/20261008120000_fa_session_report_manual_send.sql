-- A Twilio pode recusar o envio automático do Olhar FaçaAmigos (ex.: número
-- sem WhatsApp, erro 63049/63024). Até agora o relatório só virava `FAILED`
-- silenciosamente: ninguém no balcão ficava sabendo, e o responsável corria o
-- risco de nunca receber o PDF. Esta migration dá dois passos para fechar
-- esse buraco:
--   1. Publica fa_kiosk_session_reports no supabase_realtime, para a SPA
--      avisar (toast + badge piscante) no instante em que a Twilio recusa,
--      não só na próxima rodada de polling.
--   2. Adiciona o status SENT_MANUAL e a RPC que o grava, para quando o
--      operador resolve a falha abrindo o WhatsApp dele mesmo e enviando o
--      PDF na mão — sem isso o alerta piscante nunca pararia de chamar
--      atenção, mesmo depois do responsável já ter recebido o relatório.

alter table fa_kiosk_session_reports drop constraint if exists fa_kiosk_session_reports_whatsapp_status_check;
alter table fa_kiosk_session_reports add constraint fa_kiosk_session_reports_whatsapp_status_check
  check (whatsapp_status in ('PENDING', 'SENT', 'SENT_MANUAL', 'SKIPPED_NO_CONSENT', 'SKIPPED_OPT_OUT',
                             'SKIPPED_NO_PHONE', 'SKIPPED_NO_CHANNEL', 'SKIPPED_NO_TEMPLATE', 'FAILED'));

-- Realtime: deixar publicado permite a SPA trocar polling por postgres_changes
-- sem nova migration (mesmo padrão de fa_crm_contacts/fa_crm_messages).
do $$
begin
  alter publication supabase_realtime add table fa_kiosk_session_reports;
exception when others then null;
end $$;

-- Grava que o operador mesmo mandou o PDF pelo WhatsApp dele, depois que a
-- Twilio recusou (ou enquanto espera o envio automático). Chamada pela SPA
-- logo depois de abrir o link wa.me — ver Api.sessionReportSendManualPdf.
create or replace function fa_session_report_mark_sent_manually(p_report_id uuid)
returns text as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_status text;
begin
  -- TODO(human): confira a permissão e o estado atual antes de gravar.
  -- Padrão de permissão: igual a fa_session_reports_recent (acima neste
  -- arquivo) — exige fa_kiosk_can('relatorio_sessao.write'), e só deixa
  -- quem preencheu o relatório (filled_by_employee_id = v_emp) ou quem tem
  -- fa_kiosk_can('relatorio_sessao.read') marcar como enviado.
  -- Padrão de update: igual a fa_session_report_mark_dispatch (acima) —
  -- UPDATE fa_kiosk_session_reports SET whatsapp_status = 'SENT_MANUAL',
  -- whatsapp_error = null, sent_at_ms = (extract(epoch from now())*1000)::bigint
  -- WHERE id = p_report_id. Importante: não sobrescreva se o status atual já
  -- for 'SENT' (o envio automático pode ter funcionado nesse meio-tempo) —
  -- use essa condição no WHERE e devolva o whatsapp_status final em v_status.

  return v_status;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_mark_sent_manually(uuid) from public, anon;
grant execute on function fa_session_report_mark_sent_manually(uuid) to authenticated;
