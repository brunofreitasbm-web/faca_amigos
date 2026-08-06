-- Código único de venda para auditoria/rastreamento (a pedido do dono):
-- toda venda (checkout de sessão OU pedido de PDV) passa a ter um código
-- curto e legível, no estilo "VD260806-00042", junto com o id (uuid)
-- interno que já existia. Aparece no cupom e na lista de vendas do turno
-- (Caixa → Faturamento do turno).
create sequence if not exists fa_kiosk_order_code_seq;

alter table fa_kiosk_orders add column if not exists order_code text;
create unique index if not exists idx_fa_kiosk_orders_order_code
  on fa_kiosk_orders (order_code) where order_code is not null;

create or replace function fa_kiosk_next_order_code() returns text as $$
  select 'VD' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('fa_kiosk_order_code_seq')::text, 5, '0');
$$ language sql volatile;

-- fa_checkout: mesmo corpo da migration anterior, só adicionando
-- order_code na inserção de fa_kiosk_orders e no jsonb de retorno.
create or replace function fa_checkout(
  p_idempotency_key text,
  p_session_ids uuid[],
  p_payments jsonb,
  p_redeem_reward_ids uuid[],
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
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
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  for v_session in
    select * from fa_kiosk_sessions where id = any(p_session_ids) for update
  loop
    if v_session.status <> 'ATIVA' then
      raise exception 'SESSAO_JA_FECHADA: %', v_session.id;
    end if;
    if v_index = 0 then v_first_session_id := v_session.id; v_unit_id := v_session.unit_id; end if;

    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms);
    v_free_from_loyalty := (v_index = 0 and array_length(p_redeem_reward_ids, 1) > 0);

    v_line_cents := (v_timing->>'liveTotalCents')::integer;
    v_total_cents := v_total_cents + v_line_cents;

    if v_session.coupon_discount_cents > 0 then
      v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

    update fa_kiosk_sessions set status = 'AGUARDANDO_PAGAMENTO' where id = v_session.id;
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
    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms);
    insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
      values (v_order_id, 'SESSAO', 'SERVICO', format('%s — %s', v_session.child_name_snapshot, v_plan.name), 1,
        v_plan.value_cents, v_plan.value_cents, v_plan.value_cents, v_session.id);
    if (v_timing->>'overMinutes')::integer > 0 then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
          (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    update fa_kiosk_sessions set status = 'FINALIZADA', checkout_at_ms = v_now_ms, order_id = v_order_id where id = v_session.id;
    if v_session.asset_id is not null then
      update fa_kiosk_assets set status = 'DISPONIVEL',
        odometer_minutes = odometer_minutes + ceil((v_now_ms - v_session.checkin_at_ms) / 60000.0)
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
$$ language plpgsql security definer;

-- fa_create_pdv_order: mesma coisa, order_code na inserção + retorno.
create or replace function fa_create_pdv_order(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_items jsonb,
  p_payments jsonb
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_order_code text := fa_kiosk_next_order_code();
  v_item jsonb;
  v_product record;
  v_line_total integer;
  v_total_cents integer := 0;
  v_payments_total integer;
  v_payment jsonb;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = p_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from fa_kiosk_products where id = (v_item->>'productId')::uuid;
    if not found then raise exception 'PRODUTO_NAO_ENCONTRADO: %', v_item->>'productId'; end if;
    v_line_total := v_product.price_cents * (v_item->>'quantity')::integer;
    v_total_cents := v_total_cents + v_line_total;
  end loop;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_total_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_total_cents, v_payments_total;
  end if;

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code)
    values (v_order_id, p_unit_id, v_shift.id, 'PDV', v_total_cents, 'ABERTA', v_shift.business_date, v_order_code);

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from fa_kiosk_products where id = (v_item->>'productId')::uuid;
    update fa_kiosk_products set stock = stock - (v_item->>'quantity')::integer
      where id = v_product.id and stock >= (v_item->>'quantity')::integer;
    if not found then raise exception 'ESTOQUE_INSUFICIENTE: %', v_product.id; end if;

    insert into fa_kiosk_stock_movements (product_id, delta, reason, order_id, at_ms)
      values (v_product.id, -(v_item->>'quantity')::integer, 'PDV', v_order_id, v_now_ms);
    insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, product_id)
      values (v_order_id, 'PRODUTO', 'PRODUTO', v_product.name, (v_item->>'quantity')::integer,
        v_product.price_cents, v_product.price_cents, v_product.price_cents * (v_item->>'quantity')::integer, v_product.id);
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  v_cached := jsonb_build_object('orderId', v_order_id, 'orderCode', v_order_code, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_create_pdv_order', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
