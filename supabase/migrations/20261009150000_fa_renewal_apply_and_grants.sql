-- Renovação: "Dar OK" do balcão passa a TROCAR o plano na hora (+N min) e
-- fecha três pontas soltas da migration 20261009130001.
--
-- 1) fa_kiosk_apply_renewal: atômica. Soma o pedido (RENOVACAO_SOLICITADA) à
--    duração do plano atual, acha o plano de duração exata, troca e só então
--    grava RENOVACAO_APLICADA (que dispara a confirmação RENEWAL_OK no
--    WhatsApp — por isso o responsável só é avisado quando o plano mudou).
--    Sem plano equivalente único devolve um status e NÃO grava nada: o
--    balcão escolhe o plano à mão.
-- 2) fa_crm_overage_renew: a overload (uuid, integer, bigint) criada em
--    20261009130001 lia fa_crm_overage_alerts (tabela inexistente) e ficou sem
--    revoke; o webhook usa (uuid, bigint). Remove a overload e devolve os
--    horários de fechamento na versão que o webhook de fato chama.
-- 3) fa_kiosk_log_session_event estava executável por anon.

create or replace function fa_kiosk_apply_renewal(p_session_id uuid, p_employee_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session record;
  v_cur record;
  v_last record;
  v_asked integer;
  v_target integer;
  v_count integer;
  v_new record;
begin
  select * into v_session from fa_kiosk_sessions where id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'SESSAO_NAO_ATIVA'); end if;
  if v_session.status is distinct from 'ATIVA' then
    return jsonb_build_object('status', 'SESSAO_NAO_ATIVA');
  end if;

  select e.kind, e.payload_json into v_last from fa_kiosk_session_events e
   where e.session_id = p_session_id
     and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
   order by e.at_ms desc limit 1;
  if v_last.kind is distinct from 'RENOVACAO_SOLICITADA' then
    return jsonb_build_object('status', 'SEM_PEDIDO');
  end if;

  v_asked := nullif(v_last.payload_json ->> 'minutes', '')::integer;
  if v_asked is null or v_asked <= 0
     or v_session.rental_kind is not null
     or v_session.plan_id is null
     or coalesce(v_session.uses_package, false) then
    return jsonb_build_object('status', 'SEM_PLANO_EQUIVALENTE');
  end if;

  select * into v_cur from fa_kiosk_plans where id = v_session.plan_id;
  v_target := fa_kiosk_plan_duration_minutes(v_cur.duration_value, v_cur.duration_unit) + v_asked;

  select count(*) into v_count from fa_kiosk_plans p
   where p.unit_id = v_session.unit_id and p.activity = v_session.activity
     and p.active and p.asset_kind is null
     and fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) = v_target;
  if v_count = 0 then return jsonb_build_object('status', 'SEM_PLANO_EQUIVALENTE'); end if;
  if v_count > 1 then return jsonb_build_object('status', 'VARIOS_PLANOS'); end if;

  select * into v_new from fa_kiosk_plans p
   where p.unit_id = v_session.unit_id and p.activity = v_session.activity
     and p.active and p.asset_kind is null
     and fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) = v_target;

  perform fa_kiosk_change_session_plan(p_session_id, v_new.id, null);
  perform fa_kiosk_log_session_event(
    p_session_id, 'RENOVACAO_APLICADA', p_employee_id,
    jsonb_build_object('minutes', v_asked, 'newPlanId', v_new.id, 'auto', true)
  );
  return jsonb_build_object('status', 'OK', 'minutes', v_asked, 'planId', v_new.id, 'planName', v_new.name);
end;
$$;

revoke all on function fa_kiosk_apply_renewal(uuid, uuid) from public, anon;
grant execute on function fa_kiosk_apply_renewal(uuid, uuid) to authenticated, service_role;

-- 2) overage_renew
drop function if exists fa_crm_overage_renew(uuid, integer, bigint);

create or replace function fa_crm_overage_renew(p_contact_id uuid, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_notif record;
  v_status text;
  v_plan_id uuid;
  v_unit_id uuid;
  v_plan record;
  v_unit record;
  v_minutes integer;
begin
  select * into v_notif from fa_crm_visit_notifications
   where contact_id = p_contact_id and kind = 'OVERAGE' and error is null
     and sent_at_ms > p_now_ms - 3 * 3600 * 1000
   order by sent_at_ms desc limit 1
   for update;
  if not found then return jsonb_build_object('status', 'NONE'); end if;

  select s.status, s.plan_id, s.unit_id into v_status, v_plan_id, v_unit_id
    from fa_kiosk_sessions s where s.id = v_notif.session_id;
  if v_status is distinct from 'ATIVA' and v_status is distinct from 'PAUSADA' then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

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
  select * into v_unit from fa_kiosk_units where id = v_unit_id;

  perform fa_kiosk_log_session_event(
    v_notif.session_id, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', v_minutes, 'cents', v_plan.value_cents, 'via', 'WHATSAPP', 'origin', 'EXCEDENTE', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', v_minutes, 'cents', v_plan.value_cents,
    'closingHourMonSat', v_unit.closing_hour_mon_sat, 'closingHourSun', v_unit.closing_hour_sun);
end;
$$;

revoke execute on function fa_crm_overage_renew(uuid, bigint) from public, anon, authenticated;
grant execute on function fa_crm_overage_renew(uuid, bigint) to service_role;

-- 3) log_session_event: só usuário logado (balcão) e service_role; as demais
--    funções SECURITY DEFINER chamam como dono e não são afetadas.
revoke execute on function fa_kiosk_log_session_event(uuid, text, uuid, jsonb) from public, anon;
grant execute on function fa_kiosk_log_session_event(uuid, text, uuid, jsonb) to authenticated, service_role;
