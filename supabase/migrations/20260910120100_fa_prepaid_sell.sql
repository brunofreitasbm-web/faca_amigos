-- =====================================================================
-- Saldo pré-pago da criança — Venda na Entrada (Passo 2 / 8)
-- =====================================================================
-- RPC separada de fa_checkin, de propósito (ver contexto completo no
-- plano de implementação):
--   1) Atomicidade — cobrar e emitir o crédito têm que ser uma
--      transação só; duas chamadas deixariam dinheiro sem crédito, ou
--      crédito sem dinheiro, numa queda de rede no meio.
--   2) fa_checkin cria sessão (carrinho, código de acesso, PIN,
--      impressão de pulseira, visit log, fidelidade) — nada disso
--      existe quando não há sessão. Colocar isso num `if` dentro do
--      fa_checkin inflaria ainda mais a função de maior drift do repo.
--   3) Este caminho EXIGE turno aberto; fa_checkin deliberadamente não
--      exige (20260830000012 já reverteu uma restrição dessas).
--
-- O corpo é fa_upsell_vender_pacote (venda de pacote/upgrade) com outro
-- ledger no final: order → item → payments → PAGA → crédito →
-- comprovante → idempotência. Sem helper genérico de "criar order paga"
-- porque, por enquanto, só esta função usaria — extrair indireção sem
-- um segundo consumidor não paga o custo de mais uma peça no sistema.
--
-- `min_consumption_minutes` é gravado aqui como snapshot da regra de
-- origem (null = Pacote fraciona livre; duração do Plano = Plano avulso
-- não fraciona abaixo de uma visita inteira). A ALOCAÇÃO de quanto
-- conceder numa visita específica é decidida em fa_checkin quando a
-- criança volta — ver o TODO(human) na migration que adiciona esse
-- consumo (fa_prepaid_session).
-- =====================================================================

create or replace function fa_kiosk_sell_prepaid_credit(
  p_idempotency_key text,
  p_unit_id     uuid,
  p_activity    text,
  p_plan_id     uuid,
  p_package_id  uuid,
  p_guardian    jsonb,
  p_child       jsonb,
  p_coupon_code text,
  p_payments    jsonb,
  p_employee_id uuid,
  p_device_id   text default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_unit record;
  v_plan record;
  v_pkg record;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_discount_cents integer := 0;
  v_discount_base_cents integer;
  v_source_name text;
  v_source_price_cents integer;
  v_overage_cents_per_minute integer;
  v_minutes_total integer;
  v_min_consumption_minutes integer;
  v_charged_cents integer;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_order_code text;
  v_payments_total integer;
  v_payment jsonb;
  v_credit_id uuid := gen_random_uuid();
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if not fa_kiosk_can('venda.prepago') then raise exception 'SEM_PERMISSAO'; end if;
  if (p_plan_id is null) = (p_package_id is null) then
    raise exception 'ORIGEM_INVALIDA: informe exatamente um de plano ou pacote';
  end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  if p_package_id is not null then
    select * into v_pkg from fa_kiosk_packages
      where id = p_package_id and unit_id = p_unit_id and activity = p_activity and active;
    if not found then raise exception 'PACOTE_INVALIDO'; end if;
    v_source_name := v_pkg.name;
    v_source_price_cents := v_pkg.price_cents;
    v_overage_cents_per_minute := v_pkg.overage_cents_per_minute;
    v_minutes_total := v_pkg.included_minutes;
    v_min_consumption_minutes := null; -- Pacote fraciona livre.
  else
    select * into v_plan from fa_kiosk_plans
      where id = p_plan_id and unit_id = p_unit_id and activity = p_activity;
    if not found then raise exception 'PLANO_INVALIDO'; end if;
    v_source_name := v_plan.name;
    v_source_price_cents := v_plan.value_cents;
    v_overage_cents_per_minute := v_plan.overage_cents_per_minute;
    v_minutes_total := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
    v_min_consumption_minutes := v_minutes_total; -- Plano avulso: visita não fraciona abaixo do plano inteiro.
  end if;

  -- Guardian/child upsert — mesmo bloco de fa_checkin.
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

  insert into fa_kiosk_child_guardians (child_id, guardian_id, is_authorized_pickup)
    values (v_child_id, v_guardian_id, true)
    on conflict (child_id, guardian_id) do nothing;

  -- Cupom — mesma regra de fa_checkin: restrição de plano só se aplica
  -- a venda de Plano; percentual só vale para Playground.
  if p_coupon_code is not null then
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
    v_discount_base_cents := v_source_price_cents;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_discount_base_cents * v_coupon.value / 100.0); end if;
  end if;

  v_charged_cents := greatest(0, v_source_price_cents - v_coupon_discount_cents);

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total
    from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_charged_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_charged_cents, v_payments_total;
  end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = p_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  v_order_code := fa_kiosk_next_order_code();

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code)
    values (v_order_id, p_unit_id, v_shift.id, 'PDV', v_charged_cents, 'ABERTA', v_shift.business_date, v_order_code);

  insert into fa_kiosk_order_items (
    order_id, item_type, item_nature, description, quantity,
    unit_price_cents, list_unit_price_cents, total_cents)
  values (
    v_order_id, 'SESSAO', 'SERVICO',
    format('Saldo pré-pago — %s (%s)', v_source_name, p_child->>'fullName'), 1,
    v_charged_cents, v_source_price_cents, v_charged_cents);

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders
     set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms
   where id = v_order_id;

  insert into fa_kiosk_child_time_credits (
    id, unit_id, child_id, guardian_id, order_id, activity,
    plan_id, package_id, source_name_snapshot, price_cents, charged_cents,
    overage_cents_per_minute, min_consumption_minutes,
    minutes_total, remaining_minutes, purchased_at_ms
  ) values (
    v_credit_id, p_unit_id, v_child_id, v_guardian_id, v_order_id, p_activity,
    p_plan_id, p_package_id, v_source_name, v_source_price_cents, v_charged_cents,
    v_overage_cents_per_minute, v_min_consumption_minutes,
    v_minutes_total, v_minutes_total, v_now_ms
  );

  -- Comprovante — mesma transação, mesmo motivo das duas vias do
  -- check-in: se a venda gravou, o cliente sai com o papel que prova
  -- quantas horas comprou e que elas não vencem.
  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json, origin_device_id)
  values (p_unit_id, 'RECEIPT', jsonb_build_object(
    'title', 'Comprovante de Saldo Pré-pago',
    'unitName', v_unit.name,
    'unitAddress', v_unit.address,
    'unitPhone', v_unit.phone,
    'unitCnpj', v_unit.cnpj,
    'orderCode', v_order_code,
    'dateTime', to_char(to_timestamp(v_now_ms / 1000.0) at time zone coalesce(v_unit.timezone, 'America/Belem'), 'DD/MM/YYYY HH24:MI:SS'),
    'items', jsonb_build_array(jsonb_build_object(
      'description', v_source_name, 'quantity', 1, 'amountCents', v_charged_cents)),
    'totalCents', v_charged_cents,
    'customerInfo', jsonb_build_object(
      'childName', p_child->>'fullName',
      'guardianName', p_guardian->>'fullName',
      'guardianCpf', p_guardian->>'cpf',
      'phone', p_guardian->>'phoneE164'),
    'footerNote', format(
      '%s — %s min de saldo para %s, sem prazo de validade. Quando a criança voltar, o saldo é iniciado pelo Painel.',
      v_source_name, v_minutes_total, p_child->>'fullName')
  ), p_device_id);

  v_cached := jsonb_build_object(
    'creditId', v_credit_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'orderId', v_order_id, 'orderCode', v_order_code,
    'chargedCents', v_charged_cents, 'minutesTotal', v_minutes_total
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_kiosk_sell_prepaid_credit', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_sell_prepaid_credit(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, jsonb, uuid, text
) from public;
grant execute on function fa_kiosk_sell_prepaid_credit(
  text, uuid, text, uuid, uuid, jsonb, jsonb, text, jsonb, uuid, text
) to authenticated, service_role;
