-- Migration para:
-- 1. Ocultar o Termo de Uso no cupom de entrada (RECEIPT) para unidades/operações Playground.
-- 2. Devolver `activity` e `assetKind` na RPC `fa_acompanhar_por_codigo`, corrigindo a validação do responsável.

-- 1. Oculta o Termo de Uso para Playground ao enfileirar impressões de entrada (fa_kiosk_enqueue_entry_prints)
create or replace function fa_kiosk_enqueue_entry_prints(
  p_session_id uuid
) returns void as $$
declare
  v_s record;
  v_unit record;
  v_plan record;
  v_guardian record;
  v_child record;
  v_employee_name text;
  v_terms text;
  v_entry_time text;
  v_expected_exit text;
  v_notes text;
  v_duration_minutes integer;
  v_plan_name text;
  v_plan_value integer;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then return; end if;

  select * into v_unit from fa_kiosk_units where id = v_s.unit_id;
  select * into v_guardian from fa_kiosk_guardians where id = v_s.guardian_id;
  select * into v_child from fa_kiosk_children where id = v_s.child_id;
  select full_name into v_employee_name from fa_kiosk_employees where id = v_s.checkin_by_employee_id;
  select value into v_terms from fa_kiosk_app_settings where unit_id = v_s.unit_id and key = 'terms_of_use';

  if v_s.uses_hour_bank then
    v_plan_name := 'Banco de Horas';
    v_plan_value := 0;
    v_duration_minutes := coalesce(v_s.hour_bank_allocated_minutes, 0);
  elsif v_s.uses_package then
    v_plan_name := coalesce(v_s.package_name_snapshot, 'Pacote');
    v_plan_value := coalesce(v_s.package_price_cents, 0);
    v_duration_minutes := coalesce(v_s.package_allocated_minutes, 0);
  else
    select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;
    v_plan_name := coalesce(v_plan.name, 'Plano');
    v_plan_value := coalesce(v_plan.value_cents, 0);
    v_duration_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
  end if;

  v_entry_time := to_char(to_timestamp(v_s.checkin_at_ms / 1000.0) at time zone 'America/Belem', 'HH24:MI');
  v_expected_exit := to_char(
    (to_timestamp(v_s.checkin_at_ms / 1000.0) + make_interval(mins => v_duration_minutes)) at time zone 'America/Belem',
    'HH24:MI');

  v_notes := nullif(trim(both ' |' from
    coalesce(array_to_string(v_s.sensory_tags, ' | '), '') ||
    case when v_s.notes is not null and v_s.notes <> '' then ' | ' || v_s.notes else '' end), '');

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_s.unit_id, 'WRISTBAND', jsonb_build_object(
    'wristbandCode', v_s.access_code,
    'childName', v_s.child_name_snapshot,
    'guardianName', coalesce(v_guardian.full_name, 'Responsável'),
    'phone', coalesce(v_guardian.phone_e164, ''),
    'planName', v_plan_name,
    'entryTime', v_entry_time,
    'notes', v_notes
  ));

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_s.unit_id, 'RECEIPT', jsonb_build_object(
    'title', 'Check-in',
    'unitName', v_unit.name,
    'unitAddress', v_unit.address,
    'unitPhone', v_unit.phone,
    'unitCnpj', v_unit.cnpj,
    'employeeName', v_employee_name,
    'dateTime', to_char(to_timestamp(v_s.checkin_at_ms / 1000.0) at time zone 'America/Belem', 'DD/MM/YYYY HH24:MI:SS'),
    'accessCode', v_s.access_code,
    'exitPin', v_s.exit_pin,
    'qrValue', v_s.access_code,
    'entryTime', v_entry_time,
    'expectedExitTime', v_expected_exit,
    'planName', v_plan_name,
    'careNotes', v_notes,
    'activity', coalesce(v_s.activity, 'PLAYGROUND'),
    'items', jsonb_build_array(jsonb_build_object(
      'description', v_plan_name, 'quantity', 1, 'amountCents', v_plan_value)),
    'totalCents', v_plan_value,
    'customerInfo', jsonb_build_object(
      'childName', v_s.child_name_snapshot,
      'childBirthDate', to_char(v_child.birth_date, 'DD/MM/YYYY'),
      'guardianName', coalesce(v_guardian.full_name, ''),
      'guardianCpf', v_guardian.cpf,
      'phone', coalesce(v_guardian.phone_e164, '')),
    'footerNote', case when v_s.activity = 'CARRINHO' then v_terms else null end
  ));
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

-- 2. Ajusta fa_acompanhar_por_codigo para retornar activity e assetKind
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

  if v_s.uses_hour_bank or v_s.uses_package then
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
