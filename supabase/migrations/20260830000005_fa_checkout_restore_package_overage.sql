-- =====================================================================
-- Restaura a cobrança de excedente dos Pacotes (Day Use, Porto Seguro
-- etc.) no fechamento — regressão introduzida por 20260828000001.
-- =====================================================================
-- A migração 20260816000003_fa_checkin_pacotes.sql implementou em
-- fa_checkout um ramo "elsif v_session.uses_package" próprio: cobra
-- package_price_cents (preço do pacote) + minutos excedentes pela
-- tarifa configurada no cadastro do pacote (package_overage_cents_per_minute
-- — ex.: R$1,50 ou R$1,80/min conforme o pacote), igual ao ramo já
-- existente de Banco de Horas.
--
-- 20260828000001_fa_coupon_pct_overage_playground.sql reescreveu
-- fa_checkout (para recalcular o desconto percentual do cupom em cima
-- do valor real da linha) e, ao fazer isso, perdeu esse ramo: sessão de
-- Pacote (plan_id nulo) passou a cair no ramo genérico de Plano, que
-- busca v_plan em fa_kiosk_plans por plan_id — nunca encontra (NULL),
-- então v_plan.overage_cents_per_minute é sempre NULL e o
-- coalesce(..., 0) mascara isso como R$0,00/min de excedente. Ou seja,
-- desde essa migração, o minuto excedente de Day Use/Porto Seguro não
-- estava sendo cobrado pela tarifa com desconto do pacote — não estava
-- sendo cobrado de jeito nenhum.
--
-- Esta migração reintroduz o ramo "uses_package" (idêntico ao de
-- 20260816000003) nos dois laços de fa_checkout — cálculo do total e
-- geração dos itens da comanda — mantendo intacta a lógica de cupom
-- percentual acrescentada em 20260828000001.
-- =====================================================================

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
    elsif v_session.uses_package then
      -- Débito do saldo (FIFO por vencimento, consome primeiro o que o
      -- responsável já tinha antes deste pacote novo). O preço cheio do
      -- pacote é cobrado agora, na compra — diferente do banco de horas,
      -- que já foi pago quando o crédito nasceu. Excedente cobra pela
      -- tarifa do PACOTE (com desconto, ex.: 1,50 ou 1,80/min), não pela
      -- de um Plano — o plan_id da sessão é nulo aqui.
      v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      v_line_cents := coalesce(v_session.package_price_cents, 0)
        + v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0);
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
    elsif v_session.uses_package then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s', v_session.child_name_snapshot, coalesce(v_session.package_name_snapshot, 'Pacote')), 1,
          coalesce(v_session.package_price_cents, 0), coalesce(v_session.package_price_cents, 0),
          coalesce(v_session.package_price_cents, 0), v_session.id);

      if v_covered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('%s min usados do saldo do pacote', v_covered_minutes), 1,
            0, 0, 0, v_session.id);
      end if;

      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      if v_uncovered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Além do pacote (%s min)', v_uncovered_minutes), 1,
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0), v_session.id);
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
