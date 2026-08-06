-- Pausa de sessão: operador pausa o relógio da criança (banheiro, saiu do
-- espaço por algum motivo) e retoma depois. Tempo pausado não conta como
-- permanência nem gera excedente. Mantém status = 'ATIVA' o tempo todo —
-- pausa é um marcador ortogonal (paused_at_ms), não um novo status — para
-- não precisar duplicar todo lugar hoje travado em status = 'ATIVA'
-- (fa_kiosk_change_session_plan, o loop de seleção do fa_checkout).

alter table fa_kiosk_sessions add column if not exists paused_at_ms bigint;
alter table fa_kiosk_sessions add column if not exists paused_ms_total bigint not null default 0;

create or replace function fa_kiosk_pause_session(p_session_id uuid, p_reason text) returns void as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  update fa_kiosk_sessions set paused_at_ms = v_now_ms
    where id = p_session_id and status = 'ATIVA' and paused_at_ms is null;
  if not found then raise exception 'SESSAO_NAO_PAUSAVEL'; end if;
  perform fa_kiosk_log_session_event(p_session_id, 'PAUSADA', null, jsonb_build_object('reason', p_reason));
end;
$$ language plpgsql security definer;

create or replace function fa_kiosk_resume_session(p_session_id uuid) returns void as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_session record;
begin
  select * into v_session from fa_kiosk_sessions where id = p_session_id and status = 'ATIVA' for update;
  if not found or v_session.paused_at_ms is null then raise exception 'SESSAO_NAO_PAUSADA'; end if;

  update fa_kiosk_sessions set
    paused_ms_total = paused_ms_total + (v_now_ms - v_session.paused_at_ms),
    paused_at_ms = null
    where id = p_session_id;
  perform fa_kiosk_log_session_event(p_session_id, 'RETOMADA', null, '{}'::jsonb);
end;
$$ language plpgsql security definer;

-- fa_kiosk_session_timing (checkout) precisa descontar o tempo pausado
-- acumulado, senão o checkout cobraria o tempo em que a criança nem
-- estava no relógio. O parâmetro novo tem default 0, então a versão de 3
-- argumentos precisa ser derrubada antes: `create or replace` com aridade
-- diferente cria uma sobrecarga, e aí toda chamada de 3 args viraria
-- ambígua entre as duas.
drop function if exists fa_kiosk_session_timing(record, bigint, bigint);

create or replace function fa_kiosk_session_timing(p_plan record, p_checkin_at_ms bigint, p_now_ms bigint, p_paused_ms_total bigint default 0) returns jsonb as $$
declare
  elapsed_ms bigint := greatest(0, p_now_ms - p_checkin_at_ms - p_paused_ms_total);
  duration_ms bigint := fa_kiosk_plan_duration_minutes(p_plan.duration_value, p_plan.duration_unit) * 60000;
  over_ms bigint := greatest(0, elapsed_ms - duration_ms);
  over_minutes integer := ceil(over_ms / 60000.0);
  over_cents integer := over_minutes * p_plan.overage_cents_per_minute;
  live_total_cents integer := p_plan.value_cents + over_cents;
  phase text;
begin
  if over_minutes > 0 then phase := 'EXCEDENTE';
  elsif elapsed_ms < duration_ms * 0.8 then phase := 'VERDE';
  else phase := 'AMARELO';
  end if;
  return jsonb_build_object('elapsedMs', elapsed_ms, 'durationMs', duration_ms, 'overMinutes', over_minutes,
    'overCents', over_cents, 'liveTotalCents', live_total_cents, 'phase', phase);
end;
$$ language plpgsql immutable;

-- fa_checkout precisa: (a) bloquear sessão pausada — precisa retomar
-- antes de fechar — e (b) passar paused_ms_total pro cálculo acima.
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
    if v_session.paused_at_ms is not null then
      raise exception 'SESSAO_PAUSADA: %', v_session.id;
    end if;
    if v_index = 0 then v_first_session_id := v_session.id; v_unit_id := v_session.unit_id; end if;

    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, v_session.paused_ms_total);
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

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date)
    values (v_order_id, v_unit_id, v_shift.id, 'SESSAO', v_total_cents, 'ABERTA', v_shift.business_date);

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, v_session.paused_ms_total);
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

  v_cached := jsonb_build_object('orderId', v_order_id, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkout', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
