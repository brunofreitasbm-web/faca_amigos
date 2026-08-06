-- Fase 4: PDV e caixa via RPC, portando
-- apps/kiosk/src/server/routes/{shifts,pdv}.ts. `expected` continua
-- calculado só dentro de fa_close_shift(), sempre a partir dos pagamentos
-- reais gravados — nunca aceito do cliente. Isso preserva a propriedade
-- de segurança original independente da UI ser ou não "às cegas": quem
-- está sendo conferido nunca fornece o número contra o qual é conferido.

create or replace function fa_open_shift(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_opening_cash_cents integer
) returns jsonb as $$
declare
  v_cached jsonb;
  v_shift_id uuid := gen_random_uuid();
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_unit record;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  begin
    insert into fa_kiosk_shifts (id, unit_id, opened_by_employee_id, opened_at_ms, opening_cash_cents, business_date)
      values (v_shift_id, p_unit_id, p_employee_id, v_now_ms, p_opening_cash_cents,
              fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour));
  exception when unique_violation then
    raise exception 'TURNO_JA_ABERTO';
  end;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, employee_id, at_ms)
    values (v_shift_id, 'TROCO_INICIAL', p_opening_cash_cents, p_employee_id, v_now_ms);

  v_cached := jsonb_build_object('id', v_shift_id);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_open_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_record_cash_movement(
  p_idempotency_key text,
  p_shift_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_reason text,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, reason, employee_id, at_ms)
    values (p_shift_id, p_kind, p_amount_cents, p_reason, p_employee_id, (extract(epoch from now()) * 1000)::bigint);

  v_cached := jsonb_build_object('ok', true);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_record_cash_movement', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_close_shift(
  p_idempotency_key text,
  p_shift_id uuid,
  p_employee_id uuid,
  p_declared jsonb -- {"DINHEIRO": 12345, "PIX": 6789, ...}
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
  v_expected jsonb := '{}'::jsonb;
  v_divergence jsonb := '{}'::jsonb;
  v_cash_adjustments integer := 0;
  v_row record;
  v_method text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id for update;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  for v_row in
    select p.method, sum(p.amount_cents) as total_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id
    group by p.method
  loop
    v_expected := jsonb_set(v_expected, array[v_row.method], to_jsonb(v_row.total_cents));
  end loop;

  select coalesce(sum(case
      when kind in ('SUPRIMENTO', 'TROCO_INICIAL') then amount_cents
      when kind = 'SANGRIA' then -amount_cents
      else amount_cents -- AJUSTE pode ser positivo ou negativo
    end), 0) into v_cash_adjustments
  from fa_kiosk_cash_movements where shift_id = p_shift_id;

  v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(coalesce((v_expected->>'DINHEIRO')::integer, 0) + v_cash_adjustments));

  update fa_kiosk_shifts set status = 'FECHADO', closed_by_employee_id = p_employee_id,
    closed_at_ms = (extract(epoch from now()) * 1000)::bigint, declared_json = p_declared, expected_json = v_expected
    where id = p_shift_id;

  for v_method in select distinct key from (
    select jsonb_object_keys(v_expected) as key union select jsonb_object_keys(p_declared) as key
  ) k loop
    v_divergence := jsonb_set(v_divergence, array[v_method],
      to_jsonb(coalesce((p_declared->>v_method)::integer, 0) - coalesce((v_expected->>v_method)::integer, 0)));
  end loop;

  v_cached := jsonb_build_object('expected', v_expected, 'declared', p_declared, 'divergence', v_divergence);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_close_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_create_pdv_order(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_items jsonb, -- [{productId, quantity}]
  p_payments jsonb -- [{method, amountCents, ...}]
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
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

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date)
    values (v_order_id, p_unit_id, v_shift.id, 'PDV', v_total_cents, 'ABERTA', v_shift.business_date);

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

  v_cached := jsonb_build_object('orderId', v_order_id, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_create_pdv_order', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
