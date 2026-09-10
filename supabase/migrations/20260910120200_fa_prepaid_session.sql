-- =====================================================================
-- Saldo pré-pago da criança — Consumo na Entrada (Passo 4 / 8)
-- =====================================================================
-- Quando a criança volta para usar o saldo comprado antes, fa_checkin
-- ganha um modo novo (`p_child_credit_id`), mesmo padrão de
-- `p_use_hour_bank` e `p_package_id`: a sessão nasce ATIVA sem debitar
-- nada — o débito de verdade só acontece no fechamento
-- (fa_checkout, migration seguinte), igual ao banco de horas e ao
-- pacote. Nenhum valor novo de `status`: um saldo não iniciado não é
-- uma sessão, então não existe estado intermediário para modelar aqui.
--
-- `fa_checkin` é a função de maior drift do repo (~14 reescritas) —
-- por isso o `drop function` explícito abaixo, na assinatura de 16
-- argumentos: `create or replace` numa aridade diferente criaria um
-- OVERLOAD em vez de substituir (armadilha já documentada em
-- 20260808080000 e 20260816000003), e o drop também leva os grants
-- junto — por isso eles são reemitidos no fim, IDÊNTICOS aos atuais
-- (confirmado no banco vivo: anon, authenticated e service_role podem
-- chamar fa_checkin — não é só o terminal autenticado).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Colunas novas em fa_kiosk_sessions — terceiro modo ortogonal,
--    espelhando uses_hour_bank / uses_package.
-- ---------------------------------------------------------------------
alter table fa_kiosk_sessions add column if not exists uses_child_credit boolean not null default false;
alter table fa_kiosk_sessions add column if not exists child_credit_id uuid references fa_kiosk_child_time_credits (id);
alter table fa_kiosk_sessions add column if not exists child_credit_name_snapshot text;
alter table fa_kiosk_sessions add column if not exists child_credit_allocated_minutes integer;
alter table fa_kiosk_sessions add column if not exists child_credit_overage_cents_per_minute integer;
-- Fracionamento herdado do crédito (ver fa_prepaid_credit_ledger): null
-- = Pacote fraciona livre; N = Plano avulso não fraciona abaixo de uma
-- visita inteira. Usado pelo fa_checkout (migration seguinte) para
-- decidir o piso de minutos cobrados nesta visita.
alter table fa_kiosk_sessions add column if not exists child_credit_min_consumption_minutes integer;

alter table fa_kiosk_sessions drop constraint if exists fa_kiosk_sessions_plan_or_bank;
alter table fa_kiosk_sessions add constraint fa_kiosk_sessions_plan_or_bank
  check (plan_id is not null or uses_hour_bank or uses_package or uses_child_credit);


-- ---------------------------------------------------------------------
-- 2. Impressão de entrada — quarto braço na cadeia de nome/valor/duração,
--    senão a pulseira sairia com "Plano", R$ 0,00 e hora de saída zerada.
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_enqueue_entry_prints(p_session_id uuid, p_device_id text default null::text)
returns void as $$
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
  elsif v_s.uses_child_credit then
    v_plan_name := coalesce(v_s.child_credit_name_snapshot, 'Saldo pré-pago');
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

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json, origin_device_id)
  values (v_s.unit_id, 'WRISTBAND', jsonb_build_object(
    'wristbandCode', v_s.access_code,
    'childName', v_s.child_name_snapshot,
    'guardianName', coalesce(v_guardian.full_name, 'Responsável'),
    'phone', coalesce(v_guardian.phone_e164, ''),
    'planName', v_plan_name,
    'entryTime', v_entry_time,
    'notes', v_notes
  ), p_device_id);

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


-- ---------------------------------------------------------------------
-- 3. fa_checkin com o modo novo — corpo idêntico ao vigente
--    (confirmado via pg_get_functiondef no banco), só com o braço de
--    saldo pré-pago inserido antes do banco de horas.
-- ---------------------------------------------------------------------
drop function if exists fa_checkin(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[], boolean, uuid, int, uuid, text
);

create or replace function fa_checkin(
  p_idempotency_key text, p_unit_id uuid, p_activity text, p_plan_id uuid, p_asset_id uuid,
  p_guardian jsonb, p_child jsonb, p_coupon_code text, p_employee_id uuid,
  p_notes text default null, p_sensory_tags text[] default null, p_use_hour_bank boolean default false,
  p_pre_checkin_id uuid default null, p_pre_checkin_child_index integer default null,
  p_package_id uuid default null, p_device_id text default null,
  -- Consumo de saldo pré-pago (fa_kiosk_sell_prepaid_credit): a criança
  -- volta e usa o que já foi pago numa visita anterior.
  p_child_credit_id uuid default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_pkg record;
  v_closing_time text;
  v_remaining integer;
  v_plan_price_cents integer := null;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_id uuid := null;
  v_coupon_discount_cents integer := 0;
  v_coupon_kind text := null;
  v_coupon_pct integer := null;
  v_discount_base_cents integer;
  v_session_id uuid := gen_random_uuid();
  v_access_code text;
  v_exit_pin text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_business_date date;
  v_visits_after integer;
  v_rule record;
  v_bank_balance integer := 0;
  v_bank_allocated integer := null;
  v_bank_overage integer := null;
  v_pkg_allocated integer := null;
  v_pkg_name text := null;
  v_pkg_price_cents integer := null;
  v_pkg_overage integer := null;
  v_conversion_key text;
  v_credit record;
  v_credit_allocated integer := null;
  v_credit_name text := null;
  v_credit_overage integer := null;
  v_credit_min_consumption integer := null;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
  end if;

  if p_child_credit_id is not null then
    if p_activity <> 'PLAYGROUND' then raise exception 'SALDO_PREPAGO_APENAS_PLAYGROUND'; end if;
    v_child_id := nullif(p_child->>'id', '')::uuid;
    if v_child_id is null then raise exception 'SALDO_PREPAGO_SEM_CADASTRO'; end if;

    if exists (select 1 from fa_kiosk_sessions where child_id = v_child_id and status = 'ATIVA') then
      raise exception 'CRIANCA_JA_EM_SESSAO';
    end if;

    select * into v_credit from fa_kiosk_child_time_credits
      where id = p_child_credit_id and child_id = v_child_id
        and cancelled_at_ms is null and remaining_minutes > 0
      for update;
    if not found then raise exception 'SALDO_PREPAGO_INVALIDO'; end if;

    v_credit_allocated := case when v_remaining is not null then greatest(0, least(v_credit.remaining_minutes, v_remaining)) else v_credit.remaining_minutes end;
    v_credit_name := v_credit.source_name_snapshot;
    v_credit_overage := v_credit.overage_cents_per_minute;
    v_credit_min_consumption := v_credit.min_consumption_minutes;
  elsif p_use_hour_bank then
    v_child_id := nullif(p_child->>'id', '')::uuid;
    if v_child_id is null then raise exception 'BANCO_HORAS_SEM_CADASTRO'; end if;

    select coalesce(sum(remaining_minutes), 0) into v_bank_balance
      from fa_kiosk_hour_bank_credits
     where child_id = v_child_id and expires_at_ms > v_now_ms and remaining_minutes > 0;
    if v_bank_balance <= 0 then raise exception 'BANCO_HORAS_SEM_SALDO'; end if;

    select overage_cents_per_minute into v_bank_overage
      from fa_kiosk_hour_bank_credits
     where child_id = v_child_id and expires_at_ms > v_now_ms and remaining_minutes > 0
     order by expires_at_ms asc limit 1;

    v_bank_allocated := case when v_remaining is not null then greatest(0, least(v_bank_balance, v_remaining)) else v_bank_balance end;
  elsif p_package_id is not null then
    select * into v_pkg from fa_kiosk_packages
      where id = p_package_id and unit_id = p_unit_id and activity = p_activity and active;
    if not found then raise exception 'PACOTE_INVALIDO'; end if;

    v_pkg_allocated := case when v_remaining is not null then greatest(0, least(v_pkg.included_minutes, v_remaining)) else v_pkg.included_minutes end;
    v_pkg_name := v_pkg.name;
    v_pkg_price_cents := v_pkg.price_cents;
    v_pkg_overage := v_pkg.overage_cents_per_minute;
  else
    select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
    if not found then raise exception 'PLANO_INVALIDO'; end if;
    v_plan_price_cents := v_plan.value_cents;
  end if;

  if p_activity = 'CARRINHO' then
    if p_asset_id is null then raise exception 'ASSET_OBRIGATORIO'; end if;
    update fa_kiosk_assets set status = 'EM_USO'
      where id = p_asset_id and status = 'DISPONIVEL';
    if not found then raise exception 'ASSET_INDISPONIVEL'; end if;
  end if;

  v_guardian_id := nullif(p_guardian->>'id', '')::uuid;
  if v_guardian_id is null and p_guardian->>'cpf' is not null then
    select id into v_guardian_id from fa_kiosk_guardians where cpf = p_guardian->>'cpf';
  end if;
  if v_guardian_id is null then
    select id into v_guardian_id from fa_kiosk_guardians where phone_e164 = p_guardian->>'phoneE164';
  end if;
  if v_guardian_id is null then
    insert into fa_kiosk_guardians (full_name, phone_e164, cpf)
      values (p_guardian->>'fullName', p_guardian->>'phoneE164', p_guardian->>'cpf')
      returning id into v_guardian_id;
  end if;

  if v_child_id is null then
    v_child_id := nullif(p_child->>'id', '')::uuid;
  end if;
  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, inclusive_proof_type)
      values (p_child->>'fullName', (p_child->>'birthDate')::date,
              coalesce((p_child->>'inclusiveEligible')::boolean, false), p_child->>'inclusiveProofType')
      returning id into v_child_id;
  end if;

  insert into fa_kiosk_child_guardians (child_id, guardian_id, is_authorized_pickup)
    values (v_child_id, v_guardian_id, true)
    on conflict (child_id, guardian_id) do nothing;

  -- Cupom nunca se aplica ao consumo de saldo pré-pago: o desconto já
  -- foi aplicado uma vez, no momento da venda (fa_kiosk_sell_prepaid_credit).
  if p_coupon_code is not null and not p_use_hour_bank and p_child_credit_id is null then
    select * into v_coupon from fa_kiosk_coupons
      where unit_id = p_unit_id and code = p_coupon_code and active for update;
    if not found then raise exception 'CUPOM_INVALIDO'; end if;
    if v_coupon.allowed_plan_id is not null and (p_package_id is not null or v_coupon.allowed_plan_id <> p_plan_id) then
      raise exception 'CUPOM_PLANO_INVALIDO: %', 'Este cupom não é válido para o plano selecionado';
    end if;
    if v_coupon.kind = 'DESCONTO_PCT' and p_activity <> 'PLAYGROUND' then
      raise exception 'CUPOM_APENAS_PLAYGROUND: %', 'Este cupom só é válido para o Playground';
    end if;
    update fa_kiosk_coupons set used_count = used_count + 1
      where id = v_coupon.id and (max_uses = 0 or used_count < max_uses);
    if not found then raise exception 'CUPOM_ESGOTADO'; end if;
    v_discount_base_cents := case when p_package_id is not null then v_pkg_price_cents else v_plan_price_cents end;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_discount_base_cents * v_coupon.value / 100.0); end if;
    v_coupon_id := v_coupon.id;
    v_coupon_kind := v_coupon.kind;
    v_coupon_pct := case when v_coupon.kind = 'DESCONTO_PCT' then v_coupon.value else null end;
  end if;

  if p_package_id is not null then
    insert into fa_kiosk_guardian_packages (
      unit_id, guardian_id, child_id, package_id, order_id,
      package_name_snapshot, price_cents, charged_cents,
      included_minutes, remaining_minutes, purchased_at_ms, expires_at_ms
    ) values (
      p_unit_id, v_guardian_id, v_child_id, v_pkg.id, null,
      v_pkg.name, v_pkg.price_cents, greatest(0, v_pkg.price_cents - v_coupon_discount_cents),
      v_pkg.included_minutes, v_pkg.included_minutes, v_now_ms,
      v_now_ms + v_pkg.validity_days::bigint * 86400000
    );
  end if;

  v_access_code := fa_kiosk_new_access_code();
  v_business_date := fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour);
  v_exit_pin := fa_kiosk_new_exit_pin(p_unit_id, v_business_date);

  insert into fa_kiosk_sessions (
    id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
    access_code, exit_pin, wristband_code, ticket_code, notes, sensory_tags,
    checkin_at, checkin_at_ms, checkin_by_employee_id,
    coupon_id, coupon_discount_cents, coupon_kind, coupon_pct, free_from_loyalty, business_date,
    uses_hour_bank, hour_bank_allocated_minutes, hour_bank_overage_cents_per_minute,
    uses_package, package_id, package_name_snapshot, package_price_cents,
    package_allocated_minutes, package_overage_cents_per_minute,
    uses_child_credit, child_credit_id, child_credit_name_snapshot,
    child_credit_allocated_minutes, child_credit_overage_cents_per_minute,
    child_credit_min_consumption_minutes
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id,
    case when p_use_hour_bank or p_package_id is not null or p_child_credit_id is not null then null else p_plan_id end,
    v_child_id, p_child->>'fullName', v_guardian_id,
    v_access_code, v_exit_pin, v_access_code, v_access_code, nullif(trim(coalesce(p_notes, '')), ''), p_sensory_tags,
    to_timestamp(v_now_ms / 1000.0), v_now_ms, p_employee_id,
    v_coupon_id, v_coupon_discount_cents, v_coupon_kind, v_coupon_pct, false, v_business_date,
    p_use_hour_bank, v_bank_allocated, v_bank_overage,
    p_package_id is not null, p_package_id, v_pkg_name, v_pkg_price_cents,
    v_pkg_allocated, v_pkg_overage,
    p_child_credit_id is not null, p_child_credit_id, v_credit_name,
    v_credit_allocated, v_credit_overage,
    v_credit_min_consumption
  );

  insert into fa_kiosk_visit_log (child_id, activity, at, at_ms) values (v_child_id, p_activity, to_timestamp(v_now_ms / 1000.0), v_now_ms);
  select count(*) into v_visits_after from fa_kiosk_visit_log where child_id = v_child_id;

  for v_rule in
    select * from fa_kiosk_loyalty_rules
    where unit_id = p_unit_id and active and (activity = p_activity or activity = 'AMBOS')
      and trigger_visits > 0 and v_visits_after % trigger_visits = 0
  loop
    insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms) values (v_child_id, v_rule.id, v_now_ms);
  end loop;

  perform fa_kiosk_enqueue_entry_prints(v_session_id, p_device_id);

  if p_pre_checkin_id is not null then
    v_conversion_key := coalesce(p_pre_checkin_child_index, 0)::text;
    update fa_kiosk_pre_checkins
      set conversions = conversions || jsonb_build_object(v_conversion_key, v_session_id::text)
      where id = p_pre_checkin_id and status = 'PENDENTE' and not (conversions ? v_conversion_key);

    update fa_kiosk_pre_checkins
      set status = 'CONVERTIDO'
      where id = p_pre_checkin_id and status = 'PENDENTE'
        and (select count(*) from jsonb_object_keys(conversions)) >= jsonb_array_length(children);
  end if;

  v_cached := jsonb_build_object(
    'sessionId', v_session_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'accessCode', v_access_code, 'exitPin', v_exit_pin,
    'wristbandCode', v_access_code, 'ticketCode', v_access_code,
    'hourBankAllocatedMinutes', v_bank_allocated,
    'packageAllocatedMinutes', v_pkg_allocated,
    'childCreditAllocatedMinutes', v_credit_allocated,
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_checkin(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[], boolean, uuid, int, uuid, text, uuid
) from public;
grant execute on function fa_checkin(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[], boolean, uuid, int, uuid, text, uuid
) to anon, authenticated, service_role;
