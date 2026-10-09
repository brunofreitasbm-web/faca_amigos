-- Pedido de renovação iniciado pelo próprio responsável: o botão "Renovar" da
-- tela de acompanhamento abre o WhatsApp do CRM com "Quero renovar +30 min da
-- Maria". Quem escreve abre a janela de 24h, então a resposta sai como texto
-- livre, sem template da Meta e sem o limite de mensagens de Marketing.
--
-- Diferente de fa_crm_renewal_choose e fa_crm_overage_renew, não exige um aviso
-- anterior: acha a sessão ATIVA/PAUSADA do responsável do contato (e, havendo
-- mais de uma, a da criança citada) e grava o mesmo RENOVACAO_SOLICITADA que o
-- balcão já lista com "Confirmar"/"Dispensar". Sem cobrança automática.
--
-- Valores: regra do dono (mesmos para qualquer duração de plano, ver
-- RENEWAL_OPTIONS em apps/kiosk-ui/src/screens/acompanhar/copy.ts).
-- Atômico e idempotente (o WhatsApp reentrega e o cliente toca duas vezes).
-- Devolve OK | ALREADY | AMBIGUOUS | NO_SESSION | INVALID.
create or replace function fa_crm_renew_request(p_contact_id uuid, p_minutes integer, p_child_hint text, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guardian uuid;
  v_ids uuid[];
  v_session uuid;
  v_cents integer;
  v_last text;
begin
  v_cents := case p_minutes when 30 then 4800 when 60 then 9600 else (p_minutes * 160 / 100) * 100 end;
  if v_cents is null then return jsonb_build_object('status', 'INVALID'); end if;

  select coalesce(c.guardian_id, (select g.id from fa_kiosk_guardians g where g.phone_e164 = c.phone_e164 limit 1))
    into v_guardian
    from fa_crm_contacts c where c.id = p_contact_id;
  if v_guardian is null then return jsonb_build_object('status', 'NO_SESSION'); end if;

  -- Só Playground: as durações e os valores acima são os dele.
  select array_agg(s.id order by s.checkin_at_ms desc) into v_ids
    from fa_kiosk_sessions s
   where s.guardian_id = v_guardian and s.status in ('ATIVA', 'PAUSADA') and s.activity = 'PLAYGROUND';
  if v_ids is null then return jsonb_build_object('status', 'NO_SESSION'); end if;

  if array_length(v_ids, 1) = 1 then
    v_session := v_ids[1];
  else
    select s.id into v_session from fa_kiosk_sessions s
     where s.id = any (v_ids) and nullif(trim(p_child_hint), '') is not null
       and lower(s.child_name_snapshot) like lower(trim(p_child_hint)) || '%'
     order by s.checkin_at_ms desc limit 1;
    if v_session is null then return jsonb_build_object('status', 'AMBIGUOUS'); end if;
  end if;

  perform 1 from fa_kiosk_sessions where id = v_session for update;

  select e.kind into v_last from fa_kiosk_session_events e
   where e.session_id = v_session and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
   order by e.at_ms desc limit 1;
  if v_last = 'RENOVACAO_SOLICITADA' then return jsonb_build_object('status', 'ALREADY'); end if;

  perform fa_kiosk_log_session_event(
    v_session, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', p_minutes, 'cents', v_cents, 'via', 'WHATSAPP', 'origin', 'TELA', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', p_minutes, 'cents', v_cents);
end;
$$;

revoke execute on function fa_crm_renew_request(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function fa_crm_renew_request(uuid, integer, text, bigint) to service_role;
