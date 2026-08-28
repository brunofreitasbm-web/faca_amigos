-- =====================================================================
-- Cupom percentual (o 50% inclusivo / 40% padrão, auto-aplicado pela
-- EntradaScreen conforme a criança é ou não neurodivergente) passa a
-- valer também sobre o minuto adicional (excedente), não só sobre o
-- valor cheio do plano/pacote/banco de horas.
-- =====================================================================
-- Antes, fa_checkin calculava o desconto percentual só em cima do preço
-- base (plano ou pacote) e gravava esse valor fixo em
-- fa_kiosk_sessions.coupon_discount_cents. No fechamento, fa_checkout
-- simplesmente subtraía esse valor fixo do total (plano + excedente) —
-- ou seja, o excedente nunca era descontado na mesma proporção do
-- cupom, só "sobrava" um pouco de desconto por acaso quando o valor
-- fixo era maior que o plano sozinho.
--
-- Agora: fa_checkin passa a gravar também o tipo e o percentual do
-- cupom (coupon_kind/coupon_pct) na sessão. fa_checkout recalcula o
-- desconto percentual em cima do valor real cobrado na linha (que já
-- inclui o excedente, seja de Plano, Pacote ou Banco de Horas) no
-- momento do fechamento — é o único momento em que o excedente é
-- conhecido. Cupom de valor fixo (DESCONTO_VALOR) continua igual.
--
-- Restrição pedida: esse desconto percentual (o par 50%/40% inclusivo)
-- só vale para Playground — Carrinho (aluguel de carrinho em shopping)
-- fica de fora.
-- =====================================================================

alter table fa_kiosk_sessions
  add column if not exists coupon_kind text,
  add column if not exists coupon_pct integer;

-- ---------------------------------------------------------------------
-- fa_checkin: grava coupon_kind/coupon_pct e restringe cupom percentual
-- a Playground.
-- ---------------------------------------------------------------------
create or replace function fa_checkin(
  p_idempotency_key text,
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_asset_id uuid,
  p_guardian jsonb,
  p_child jsonb,
  p_coupon_code text,
  p_employee_id uuid,
  p_notes text default null,
  p_sensory_tags text[] default null,
  p_use_hour_bank boolean default false,
  p_pre_checkin_id uuid default null,
  p_pre_checkin_child_index int default null,
  p_package_id uuid default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_pkg record;
  v_closing_time text;
  v_remaining integer;
  v_plan_minutes integer;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_id uuid := null;
  v_coupon_discount_cents integer := 0;
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
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
  end if;

  if p_use_hour_bank then
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

    if v_remaining is not null and v_remaining <= 0 then
      raise exception 'FORA_DO_HORARIO: %', 'O shopping já está fechando — não é possível iniciar novas entradas';
    end if;
    v_bank_allocated := case when v_remaining is not null then least(v_bank_balance, v_remaining) else v_bank_balance end;
  elsif p_package_id is not null then
    select * into v_pkg from fa_kiosk_packages
      where id = p_package_id and unit_id = p_unit_id and activity = p_activity and active;
    if not found then raise exception 'PACOTE_INVALIDO'; end if;

    if v_remaining is not null and v_remaining <= 0 then
      raise exception 'FORA_DO_HORARIO: %', 'O shopping já está fechando — não é possível iniciar novas entradas';
    end if;
    v_pkg_allocated := case when v_remaining is not null then least(v_pkg.included_minutes, v_remaining) else v_pkg.included_minutes end;
    v_pkg_name := v_pkg.name;
    v_pkg_price_cents := v_pkg.price_cents;
    v_pkg_overage := v_pkg.overage_cents_per_minute;
  else
    select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
    if not found then raise exception 'PLANO_INVALIDO'; end if;

    if v_remaining is not null then
      v_plan_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
      if v_plan_minutes > v_remaining
         and v_plan_minutes <= fa_kiosk_setting_int(p_unit_id, 'hour_bank_threshold_minutes', 120) then
        raise exception 'FORA_DO_HORARIO: %', case when v_remaining > 0
          then format('Este plano não cabe até o fechamento (faltam %s min)', v_remaining)
          else 'O shopping já está fechando — não é possível iniciar novos planos' end;
      end if;
      if v_remaining <= 0 then
        raise exception 'FORA_DO_HORARIO: %', 'O shopping já está fechando — não é possível iniciar novos planos';
      end if;
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

  -- Cupom não se combina com Banco de Horas (não há valor de plano/pacote
  -- para descontar: o saldo já foi pago num fechamento anterior). Combina
  -- com Plano e com Pacote.
  if p_coupon_code is not null and not p_use_hour_bank then
    select * into v_coupon from fa_kiosk_coupons
      where unit_id = p_unit_id and code = p_coupon_code and active for update;
    if not found then raise exception 'CUPOM_INVALIDO'; end if;
    -- Cupom restrito a um Plano específico não faz sentido em Pacote
    -- (p_plan_id vem nulo nesse fluxo) — trata como cupom inválido aqui.
    if v_coupon.allowed_plan_id is not null and (p_package_id is not null or v_coupon.allowed_plan_id <> p_plan_id) then
      raise exception 'CUPOM_PLANO_INVALIDO: %', 'Este cupom não é válido para o plano selecionado';
    end if;
    -- O desconto percentual (o par 50% inclusivo / 40% padrão) só vale
    -- para Playground — Carrinho (aluguel de carrinho em shopping) fica
    -- de fora dessa promoção.
    if v_coupon.kind = 'DESCONTO_PCT' and p_activity <> 'PLAYGROUND' then
      raise exception 'CUPOM_APENAS_PLAYGROUND: %', 'Este cupom só é válido para o Playground';
    end if;
    update fa_kiosk_coupons set used_count = used_count + 1
      where id = v_coupon.id and (max_uses = 0 or used_count < max_uses);
    if not found then raise exception 'CUPOM_ESGOTADO'; end if;
    v_discount_base_cents := case when p_package_id is not null then v_pkg_price_cents else v_plan.value_cents end;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_discount_base_cents * v_coupon.value / 100.0); end if;
    v_coupon_id := v_coupon.id;
  end if;

  -- Compra do pacote acontece aqui, depois de guardian/child e do cupom
  -- resolvidos: charged_cents já sai gravado com o valor com desconto
  -- (price_cents continua com o preço cheio de catálogo, para histórico).
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
    package_allocated_minutes, package_overage_cents_per_minute
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id,
    case when p_use_hour_bank or p_package_id is not null then null else p_plan_id end,
    v_child_id, p_child->>'fullName', v_guardian_id,
    v_access_code, v_exit_pin, v_access_code, v_access_code, nullif(trim(coalesce(p_notes, '')), ''), p_sensory_tags,
    to_timestamp(v_now_ms / 1000.0), v_now_ms, p_employee_id,
    v_coupon_id, v_coupon_discount_cents, v_coupon.kind, v_coupon.value, false, v_business_date,
    p_use_hour_bank, v_bank_allocated, v_bank_overage,
    p_package_id is not null, p_package_id, v_pkg_name, v_pkg_price_cents,
    v_pkg_allocated, v_pkg_overage
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

  perform fa_kiosk_enqueue_entry_prints(v_session_id);

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
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------
-- fa_checkout: recalcula o desconto percentual em cima do valor real da
-- linha (plano/pacote/banco de horas + excedente) no fechamento, quando
-- o cupom da sessão for percentual e a atividade for Playground. Cupom
-- de valor fixo continua com o comportamento antigo (subtrai capado ao
-- valor da linha). O valor efetivamente aplicado é regravado em
-- coupon_discount_cents para os relatórios (Extrato do turno etc.)
-- continuarem batendo com o que foi realmente cobrado.
-- ---------------------------------------------------------------------
create or replace function fa_checkout(
  p_idempotency_key text,
  p_session_ids uuid[],
  p_payments jsonb,
  p_redeem_reward_ids uuid[],
  p_employee_id uuid,
  p_closed_at_ms bigint default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_actual_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_now_ms bigint := least(coalesce(p_closed_at_ms, v_actual_now_ms), v_actual_now_ms);
  v_session record;
  v_plan record;
  v_timing jsonb;
  v_total_cents integer := 0;
  v_payments_total integer := 0;
  v_unit_id uuid;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_order_code text := fa_kiosk_next_order_code();
  v_payment jsonb;
  v_index integer := 0;
  v_first_session_id uuid;
  v_reward_id uuid;
  v_free_from_loyalty boolean;
  v_line_cents integer;
  v_applied_discount integer;
  v_valid_employee_id uuid := p_employee_id;
  v_covered jsonb := '{}'::jsonb;
  v_covered_minutes integer;
  v_elapsed_minutes integer;
  v_uncovered_minutes integer;
  v_extra record;
  v_extra_cents integer;
  v_plan_minutes integer;
  v_bank_leftover integer;
  v_bank_validity_days integer;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if v_valid_employee_id is not null and not exists (select 1 from fa_kiosk_employees where id = v_valid_employee_id) then
    select id into v_valid_employee_id from fa_kiosk_employees limit 1;
  end if;

  for v_session in
    select * from fa_kiosk_sessions where id = any(p_session_ids) for update
  loop
    if v_session.status not in ('ATIVA', 'AGUARDANDO_PAGAMENTO') then
      raise exception 'SESSAO_JA_FECHADA: %', v_session.id;
    end if;
    if v_session.paused_at_ms is not null then
      raise exception 'SESSAO_PAUSADA: %', v_session.id;
    end if;
    if v_index = 0 then v_first_session_id := v_session.id; v_unit_id := v_session.unit_id; end if;

    v_free_from_loyalty := (v_index = 0 and array_length(p_redeem_reward_ids, 1) > 0);
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) / 60000.0)::integer);

    if v_session.uses_hour_bank then
      v_covered_minutes := fa_kiosk_hour_bank_consume(v_session.child_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      v_line_cents := v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0);
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));
      v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));

      if v_covered_minutes > 0 then
        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
        v_line_cents := v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0);
      else
        v_line_cents := (v_timing->>'liveTotalCents')::integer;
      end if;
    end if;
    v_total_cents := v_total_cents + v_line_cents;

    v_applied_discount := 0;
    if coalesce(v_session.coupon_discount_cents, 0) > 0 then
      if v_session.coupon_kind = 'DESCONTO_PCT' and v_session.activity = 'PLAYGROUND' then
        -- Recalcula sobre o valor real da linha (já com excedente), não
        -- sobre o valor fixo gravado no check-in — é o que garante que o
        -- minuto adicional também recebe o mesmo percentual de desconto.
        v_applied_discount := least(v_line_cents, round(v_line_cents * coalesce(v_session.coupon_pct, 0) / 100.0)::integer);
      else
        v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      end if;
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

    select coalesce(sum(quantity * unit_price_cents), 0) into v_extra_cents
      from fa_kiosk_session_extra_items where session_id = v_session.id and order_id is null;
    v_total_cents := v_total_cents + v_extra_cents;

    update fa_kiosk_sessions set status = 'AGUARDANDO_PAGAMENTO', coupon_discount_cents = v_applied_discount where id = v_session.id;
    v_index := v_index + 1;
  end loop;

  if v_index <> array_length(p_session_ids, 1) then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_total_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_total_cents, v_payments_total;
  end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = v_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code)
    values (v_order_id, v_unit_id, v_shift.id, 'SESSAO', v_total_cents, 'ABERTA', v_shift.business_date, v_order_code);

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    v_covered_minutes := coalesce((v_covered->>v_session.id::text)::integer, 0);
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) / 60000.0)::integer);

    if v_session.uses_hour_bank then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s min do banco de horas', v_session.child_name_snapshot, v_covered_minutes), 1,
          0, 0, 0, v_session.id);

      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      if v_uncovered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Além do banco de horas (%s min)', v_uncovered_minutes), 1,
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0), v_session.id);
      end if;
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));

      if v_covered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO',
            format('%s — %s min do pacote', v_session.child_name_snapshot, v_covered_minutes), 1,
            0, coalesce(v_plan.value_cents, 0), 0, v_session.id);

        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
        if v_uncovered_minutes > 0 then
          insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
            values (v_order_id, 'SESSAO', 'SERVICO', format('Além do saldo (%s min)', v_uncovered_minutes), 1,
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0),
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0),
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0), v_session.id);
        end if;
      else
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('%s — %s', v_session.child_name_snapshot, coalesce(v_plan.name, 'Plano')), 1,
            coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), v_session.id);
        if (v_timing->>'overMinutes')::integer > 0 then
          insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
            values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
              (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
        end if;

        v_plan_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
        if v_plan_minutes > fa_kiosk_setting_int(v_session.unit_id, 'hour_bank_threshold_minutes', 120) then
          v_bank_leftover := v_plan_minutes - least(v_plan_minutes, v_elapsed_minutes);
          if v_bank_leftover >= 1 then
            v_bank_validity_days := fa_kiosk_setting_int(v_session.unit_id, 'hour_bank_validity_days', 45);
            insert into fa_kiosk_hour_bank_credits (
              child_id, source_session_id, source_unit_id, plan_name_snapshot,
              overage_cents_per_minute, minutes_total, remaining_minutes, created_at_ms, expires_at_ms
            ) values (
              v_session.child_id, v_session.id, v_session.unit_id, coalesce(v_plan.name, 'Plano'),
              coalesce(v_plan.overage_cents_per_minute, 0), v_bank_leftover, v_bank_leftover,
              v_now_ms, v_now_ms + v_bank_validity_days::bigint * 86400000
            ) on conflict (source_session_id) do nothing;

            insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
              values (v_order_id, 'SESSAO', 'SERVICO',
                format('Banco de horas: +%s min (vale %s dias, em qualquer unidade)', v_bank_leftover, v_bank_validity_days), 1,
                0, 0, 0, v_session.id);
          end if;
        end if;
      end if;
    end if;

    for v_extra in select ei.*, p.name as product_name from fa_kiosk_session_extra_items ei
      join fa_kiosk_products p on p.id = ei.product_id
      where ei.session_id = v_session.id and ei.order_id is null
    loop
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, product_id, session_id)
        values (v_order_id, 'PRODUTO', 'PRODUTO', v_extra.product_name, v_extra.quantity,
          v_extra.unit_price_cents, v_extra.unit_price_cents, v_extra.quantity * v_extra.unit_price_cents,
          v_extra.product_id, v_session.id);
      update fa_kiosk_session_extra_items set order_id = v_order_id where id = v_extra.id;
    end loop;
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = v_valid_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    update fa_kiosk_sessions set status = 'FINALIZADA', checkout_at_ms = v_now_ms, order_id = v_order_id where id = v_session.id;
    if v_session.asset_id is not null then
      update fa_kiosk_assets set status = 'DISPONIVEL',
        odometer_minutes = odometer_minutes + ceil((v_now_ms - coalesce(v_session.checkin_at_ms, v_now_ms)) / 60000.0)
        where id = v_session.asset_id;
    end if;
  end loop;

  foreach v_reward_id in array coalesce(p_redeem_reward_ids, array[]::uuid[]) loop
    update fa_kiosk_loyalty_rewards set redeemed_at_ms = v_now_ms, redeemed_session_id = v_first_session_id
      where id = v_reward_id and redeemed_at_ms is null;
  end loop;

  v_cached := jsonb_build_object('orderId', v_order_id, 'orderCode', v_order_code, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkout', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, extensions, pg_temp;
