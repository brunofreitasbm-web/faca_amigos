-- fa_checkin() sempre falhava com "record v_coupon is not assigned yet"
-- quando o check-in não usava cupom (o caso comum): v_coupon só é
-- atribuído dentro do bloco `if p_coupon_code is not null`, mas o INSERT
-- final lia v_coupon.id incondicionalmente. Troca por uma variável
-- v_coupon_id (uuid, default null) atribuída só quando há cupom.
create or replace function fa_checkin(
  p_idempotency_key text,
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_asset_id uuid,
  p_guardian jsonb,
  p_child jsonb,
  p_coupon_code text,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_closing_time text;
  v_remaining integer;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_id uuid := null;
  v_coupon_discount_cents integer := 0;
  v_session_id uuid := gen_random_uuid();
  v_short_id text := replace(v_session_id::text, '-', '');
  v_wristband text;
  v_ticket text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_visits_after integer;
  v_rule record;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
  if not found then raise exception 'PLANO_INVALIDO'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
    if v_remaining is not null and fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit) > v_remaining then
      raise exception 'FORA_DO_HORARIO: %', case when v_remaining > 0
        then format('Este plano não cabe até o fechamento (faltam %s min)', v_remaining)
        else 'O shopping já está fechando — não é possível iniciar novos planos' end;
    end if;
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

  v_child_id := nullif(p_child->>'id', '')::uuid;
  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, inclusive_proof_type)
      values (p_child->>'fullName', (p_child->>'birthDate')::date,
              coalesce((p_child->>'inclusiveEligible')::boolean, false), p_child->>'inclusiveProofType')
      returning id into v_child_id;
  end if;
  insert into fa_kiosk_child_guardians (child_id, guardian_id) values (v_child_id, v_guardian_id)
    on conflict (child_id, guardian_id) do nothing;

  if p_coupon_code is not null then
    select * into v_coupon from fa_kiosk_coupons
      where unit_id = p_unit_id and code = p_coupon_code and active for update;
    if not found then raise exception 'CUPOM_INVALIDO'; end if;
    update fa_kiosk_coupons set used_count = used_count + 1
      where id = v_coupon.id and (max_uses = 0 or used_count < max_uses);
    if not found then raise exception 'CUPOM_ESGOTADO'; end if;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_plan.value_cents * v_coupon.value / 100.0); end if;
    v_coupon_id := v_coupon.id;
  end if;

  v_wristband := format('FA1|W|%s|%s', v_short_id, fa_kiosk_hmac8(v_short_id));
  v_ticket := format('FA1|T|%s|%s', v_short_id, fa_kiosk_hmac8(v_short_id));

  insert into fa_kiosk_sessions (
    id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
    wristband_code, ticket_code, checkin_at_ms, checkin_by_employee_id,
    coupon_id, coupon_discount_cents, free_from_loyalty, business_date
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id, p_plan_id, v_child_id, p_child->>'fullName', v_guardian_id,
    v_wristband, v_ticket, v_now_ms, p_employee_id,
    v_coupon_id, v_coupon_discount_cents, false, fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour)
  );

  insert into fa_kiosk_visit_log (child_id, activity, at_ms) values (v_child_id, p_activity, v_now_ms);
  select count(*) into v_visits_after from fa_kiosk_visit_log where child_id = v_child_id;

  for v_rule in
    select * from fa_kiosk_loyalty_rules
    where unit_id = p_unit_id and active and (activity = p_activity or activity = 'AMBOS')
      and trigger_visits > 0 and v_visits_after % trigger_visits = 0
  loop
    insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms) values (v_child_id, v_rule.id, v_now_ms);
  end loop;

  v_cached := jsonb_build_object(
    'sessionId', v_session_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'wristbandCode', v_wristband, 'ticketCode', v_ticket,
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
