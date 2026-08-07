-- Fase 3 do plano fiscal: o gancho da emissão.
--
-- Reemite fa_create_pdv_order inteira — padrão que este repositório já usa
-- (a migration 21 reescreveu as duas RPCs por completo só para acrescentar
-- order_code) — com duas mudanças:
--
--   1. `perform fa_fiscal_enqueue_for_order(v_order_id)` logo após o pedido
--      virar PAGA, dentro da MESMA transação. Ou a venda existe com documento
--      enfileirado, ou nenhuma das duas existe.
--   2. `p_fiscal_cpf` opcional — o clássico "CPF na nota?" do caixa.
--
-- fa_checkout NÃO é tocada: sessão é serviço (NFS-e), fora do escopo.
--
-- Por que aqui e não num trigger: dá para ler a RPC de cima a baixo e ver a
-- linha que dispara a nota. Um trigger seria invisível para quem lê a função
-- e dispararia em UPDATEs que ninguém previu — uma correção manual pelo
-- dashboard, por exemplo, reemitiria uma nota.
--
-- Por que não no cliente: o kiosk-ui roda no navegador, pode estar offline
-- (offlineQueue.ts existe por isso) e pode ser fechado no meio. E o reenvio do
-- callResilient geraria nota DUPLICADA — aqui dentro, o cache de idempotência
-- devolve o resultado anterior e não enfileira de novo.

-- Drop antes de recriar porque a assinatura mudou (ganhou p_fiscal_cpf). Sem
-- isto o Postgres criaria uma sobrecarga e o PostgREST ficaria ambíguo.
drop function if exists fa_create_pdv_order(text, uuid, uuid, jsonb, jsonb);

create or replace function fa_create_pdv_order(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_fiscal_cpf text default null
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
  v_fiscal_cpf text := nullif(regexp_replace(coalesce(p_fiscal_cpf, ''), '\D', '', 'g'), '');
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

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code, fiscal_cpf)
    values (v_order_id, p_unit_id, v_shift.id, 'PDV', v_total_cents, 'ABERTA', v_shift.business_date, v_order_code, v_fiscal_cpf);

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

  -- Emissão fiscal: só enfileira. Nenhuma chamada de rede acontece aqui.
  perform fa_fiscal_enqueue_for_order(v_order_id);

  v_cached := jsonb_build_object('orderId', v_order_id, 'orderCode', v_order_code, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_create_pdv_order', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
