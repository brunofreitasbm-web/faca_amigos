-- =====================================================================
-- Cronômetro do painel do responsável ancorado no relógio do servidor
-- =====================================================================
-- Bug reportado: no celular do responsável, o cronômetro fica parado em
-- 00:00 por alguns minutos após o check-in e só então começa a contar —
-- porque o cliente calcula elapsedMs como `Date.now() (do celular) -
-- checkinAtMs (do servidor)`, e o relógio do celular pode estar
-- atrasado/adiantado em relação ao servidor. Enquanto o relógio do
-- celular não alcança checkinAtMs, a subtração fica negativa e
-- Math.max(0, ...) trava o mostrador em zero.
--
-- Correção: a RPC devolve também o instante atual do servidor
-- (serverNowMs). O cliente usa isso só para calcular um offset
-- (serverNowMs - Date.now() no momento da resposta) e soma esse offset
-- em todo Date.now() local usado no cronômetro — sem depender do
-- relógio do aparelho estar certo.
create or replace function fa_acompanhar_por_codigo(p_code text) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code;
  if not found then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  if v_s.status = 'FINALIZADA' then
    return jsonb_build_object(
      'status', 'FINALIZADA',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
      'checkoutAtMs', v_s.checkout_at_ms
    );
  end if;

  if v_s.uses_hour_bank then
    return jsonb_build_object(
      'status', 'NAO_SUPORTADO',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1)
    );
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;

  return jsonb_build_object(
    'status', case when v_s.paused_at_ms is not null then 'PAUSADA' else 'ATIVA' end,
    'sessionId', v_s.id,
    'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
    'checkinAtMs', v_s.checkin_at_ms,
    'pausedAtMs', v_s.paused_at_ms,
    'pausedMsTotal', coalesce(v_s.paused_ms_total, 0),
    'serverNowMs', v_now_ms,
    'sensoryTags', to_jsonb(coalesce(v_s.sensory_tags, array[]::text[])),
    'plan', jsonb_build_object(
      'durationValue', v_plan.duration_value,
      'durationUnit', v_plan.duration_unit,
      'valueCents', v_plan.value_cents,
      'overageCentsPerMinute', v_plan.overage_cents_per_minute
    )
  );
end;
$$ language plpgsql stable security definer;
