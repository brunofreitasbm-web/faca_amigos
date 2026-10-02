-- Renovação do plano atual pelo aviso de excedente (template fa_visita_excedente_v2).
--
-- O responsável recebe "o tempo do plano terminou" com 1 botão SIM. Tocar em SIM
-- grava RENOVACAO_SOLICITADA para o plano da própria sessão (duração e valor da
-- tabela vigente), o MESMO evento que o painel do balcão já lista com
-- "Confirmar"/"Dispensar". Quando o operador confirma (RENOVACAO_APLICADA), o
-- responsável recebe a confirmação pelo template fa_visita_renovacao_ok. Sem
-- cobrança automática: o valor é acertado no caixa.
--
-- Atômico e idempotente (o WhatsApp reentrega e o cliente toca duas vezes).
-- Devolve OK | ALREADY | EXPIRED | NONE para o webhook escolher a resposta.
create or replace function fa_crm_overage_renew(p_contact_id uuid, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_notif record;
  v_status text;
  v_plan_id uuid;
  v_plan record;
  v_minutes integer;
begin
  -- Aviso de excedente mais recente deste contato, nas últimas 3 horas.
  select * into v_notif from fa_crm_visit_notifications
   where contact_id = p_contact_id and kind = 'OVERAGE' and error is null
     and sent_at_ms > p_now_ms - 3 * 3600 * 1000
   order by sent_at_ms desc limit 1
   for update;
  if not found then return jsonb_build_object('status', 'NONE'); end if;

  select s.status, s.plan_id into v_status, v_plan_id from fa_kiosk_sessions s where s.id = v_notif.session_id;
  if v_status is distinct from 'ATIVA' and v_status is distinct from 'PAUSADA' then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  -- Já houve pedido, aplicação ou dispensa depois do aviso: não duplica.
  if exists (
    select 1 from fa_kiosk_session_events e
     where e.session_id = v_notif.session_id
       and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
       and e.at_ms >= v_notif.sent_at_ms
  ) then
    return jsonb_build_object('status', 'ALREADY');
  end if;

  select value_cents, duration_value, duration_unit into v_plan
    from fa_kiosk_plans where id = v_plan_id;
  v_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);

  perform fa_kiosk_log_session_event(
    v_notif.session_id, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', v_minutes, 'cents', v_plan.value_cents, 'via', 'WHATSAPP', 'origin', 'EXCEDENTE', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', v_minutes, 'cents', v_plan.value_cents);
end;
$$;

revoke execute on function fa_crm_overage_renew(uuid, bigint) from public, anon, authenticated;
grant execute on function fa_crm_overage_renew(uuid, bigint) to service_role;
