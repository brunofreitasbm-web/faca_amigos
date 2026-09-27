-- Fix impressao Circuito:
-- 1. Impede criacao de job de WRISTBAND (pulseira) para sessoes do Circuito (activity = 'CARRINHO').
-- 2. Inclui o assetName (nome do carrinho/miniveiculo) no payload_json do RECEIPT.

create or replace function fa_kiosk_enqueue_entry_prints(p_session_id uuid, p_device_id text default null::text)
returns void as $$
declare
  v_s record;
  v_unit record;
  v_plan record;
  v_guardian record;
  v_child record;
  v_asset_name text := null;
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
  if v_s.asset_id is not null then
    select name into v_asset_name from fa_kiosk_assets where id = v_s.asset_id;
  end if;
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
  elsif v_s.uses_child_credit then
    v_plan_name := coalesce(v_s.child_credit_name_snapshot, 'Saldo pre-pago');
    v_plan_value := 0;
    v_duration_minutes := coalesce(v_s.child_credit_allocated_minutes, 0);
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

  -- Pulseira so e impressa para entradas no Playground.
  -- No Circuito (activity = 'CARRINHO') ou no Aluguel de Pelucia (rental_kind is not null),
  -- NAO ha impressao de pulseira.
  if v_s.rental_kind is null and coalesce(v_s.activity, 'PLAYGROUND') <> 'CARRINHO' then
    insert into fa_kiosk_print_jobs (unit_id, kind, payload_json, origin_device_id)
    values (v_s.unit_id, 'WRISTBAND', jsonb_build_object(
      'wristbandCode', v_s.access_code,
      'childName', v_s.child_name_snapshot,
      'guardianName', coalesce(v_guardian.full_name, 'Responsavel'),
      'phone', coalesce(v_guardian.phone_e164, ''),
      'planName', v_plan_name,
      'entryTime', v_entry_time,
      'notes', v_notes
    ), p_device_id);
  end if;

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json, origin_device_id)
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
    'assetName', v_asset_name,
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
  ), p_device_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
