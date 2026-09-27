-- Migration: Retorna childVisitCount na RPC fa_acompanhar_por_codigo para exibir no painel do responsável
create or replace function fa_acompanhar_por_codigo(p_code text) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_visit_count integer := 1;
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

  if v_s.uses_hour_bank or v_s.uses_package then
    return jsonb_build_object(
      'status', 'NAO_SUPORTADO',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1)
    );
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;

  -- Contagem de visitas da criança (ou do responsável se child_id não definido)
  if v_s.child_id is not null then
    select count(distinct id) into v_visit_count
    from fa_kiosk_sessions
    where child_id = v_s.child_id;
  elsif v_s.guardian_id is not null then
    select count(distinct id) into v_visit_count
    from fa_kiosk_sessions
    where guardian_id = v_s.guardian_id;
  end if;

  return jsonb_build_object(
    'status', case when v_s.paused_at_ms is not null then 'PAUSADA' else 'ATIVA' end,
    'sessionId', v_s.id,
    'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
    'childVisitCount', coalesce(v_visit_count, 1),
    'activity', coalesce(v_s.activity, 'PLAYGROUND'),
    'checkinAtMs', v_s.checkin_at_ms,
    'pausedAtMs', v_s.paused_at_ms,
    'pausedMsTotal', coalesce(v_s.paused_ms_total, 0),
    'serverNowMs', v_now_ms,
    'sensoryTags', to_jsonb(coalesce(v_s.sensory_tags, array[]::text[])),
    'plan', jsonb_build_object(
      'durationValue', v_plan.duration_value,
      'durationUnit', v_plan.duration_unit,
      'valueCents', v_plan.value_cents,
      'overageCentsPerMinute', v_plan.overage_cents_per_minute,
      'assetKind', v_plan.asset_kind
    )
  );
end;
$$ language plpgsql stable security definer;

grant execute on function fa_acompanhar_por_codigo(text) to anon, authenticated, service_role;
