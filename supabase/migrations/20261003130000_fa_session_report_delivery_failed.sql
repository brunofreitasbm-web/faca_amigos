-- Olhar FaçaAmigos: o status do relatório passa a refletir a ENTREGA real.
--
-- Antes: session-report-dispatch gravava SENT assim que a Twilio aceitava a
-- mensagem. Se a Meta recusava depois (ex.: erro 63049), o webhook marcava só
-- fa_crm_messages como 'undelivered' e o relatório continuava "Enviado", sem
-- botão de reenviar. Agora, quando a mensagem do relatório vira failed /
-- undelivered, o relatório volta para FAILED (já "retryable" nas duas telas) e
-- guarda o motivo. Um reenvio cria outra mensagem e regrava crm_message_id,
-- então falhas tardias da mensagem antiga não afetam o novo envio.

create or replace function fa_session_report_on_message_failed() returns trigger as $$
begin
  update fa_kiosk_session_reports set
    whatsapp_status = 'FAILED',
    whatsapp_error = 'Entrega recusada pelo WhatsApp' || coalesce(' (' || new.error || ')', '')
  where crm_message_id = new.id
    and whatsapp_status = 'SENT';
  return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_on_message_failed() from public, anon, authenticated;

drop trigger if exists trg_fa_session_report_delivery_failed on fa_crm_messages;
create trigger trg_fa_session_report_delivery_failed
  after update of status on fa_crm_messages
  for each row
  when (new.status in ('failed', 'undelivered') and old.status is distinct from new.status)
  execute function fa_session_report_on_message_failed();

-- Corrige os que já falharam e ficaram como "Enviado".
update fa_kiosk_session_reports r set
  whatsapp_status = 'FAILED',
  whatsapp_error = 'Entrega recusada pelo WhatsApp' || coalesce(' (' || m.error || ')', '')
from fa_crm_messages m
where m.id = r.crm_message_id
  and r.whatsapp_status = 'SENT'
  and m.status in ('failed', 'undelivered');
