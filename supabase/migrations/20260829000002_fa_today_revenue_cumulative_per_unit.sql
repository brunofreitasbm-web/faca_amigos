-- Migration: Atualiza fa_kiosk_today_revenue e fa_kiosk_today_ticket_medio para faturamento acumulado diário por unidade
-- Garante o cálculo exato somando ordens pagas no dia operacional + sessões registradas que ainda não possuem ordem paga.

create or replace function fa_kiosk_today_revenue(p_unit_id uuid, p_business_date text) returns integer as $$
declare
  v_orders_cents integer := 0;
  v_unbilled_sessions_cents integer := 0;
begin
  -- 1. Total faturado em ordens pagas (sessões pagas, produtos, snacks, meias, tempo extra, etc)
  select coalesce(sum(total_cents), 0)::integer into v_orders_cents
  from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA';

  -- 2. Total de sessões ativas/registradas no dia operacional que ainda não possuem ordem paga vinculada
  select coalesce(sum(
    greatest(0, coalesce(s.package_price_cents, p.price_cents, 0) - coalesce(s.coupon_discount_cents, 0))
  ), 0)::integer into v_unbilled_sessions_cents
  from fa_kiosk_sessions s
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id = p_unit_id
    and s.business_date = p_business_date::date
    and s.status <> 'CANCELADA'
    and (s.order_id is null or s.order_id not in (
      select id from fa_kiosk_orders where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA'
    ));

  return v_orders_cents + v_unbilled_sessions_cents;
end;
$$ language plpgsql stable;

create or replace function fa_kiosk_today_ticket_medio(p_unit_id uuid, p_business_date text)
returns table(total_cents integer, orders_count integer, avg_cents integer) as $$
declare
  v_orders_cents integer := 0;
  v_orders_count integer := 0;
  v_unbilled_sessions_cents integer := 0;
  v_unbilled_sessions_count integer := 0;
  v_tot integer := 0;
  v_cnt integer := 0;
  v_avg integer := 0;
begin
  -- 1. Ordens pagas no dia operacional
  select coalesce(sum(total_cents), 0)::integer, count(*)::integer
  into v_orders_cents, v_orders_count
  from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA';

  -- 2. Sessões ativas/registradas no dia que ainda não possuem ordem paga
  select
    coalesce(sum(greatest(0, coalesce(s.package_price_cents, p.price_cents, 0) - coalesce(s.coupon_discount_cents, 0))), 0)::integer,
    count(*)::integer
  into v_unbilled_sessions_cents, v_unbilled_sessions_count
  from fa_kiosk_sessions s
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id = p_unit_id
    and s.business_date = p_business_date::date
    and s.status <> 'CANCELADA'
    and (s.order_id is null or s.order_id not in (
      select id from fa_kiosk_orders where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA'
    ));

  v_tot := v_orders_cents + v_unbilled_sessions_cents;
  v_cnt := v_orders_count + v_unbilled_sessions_count;
  v_avg := case when v_cnt > 0 then round(v_tot::numeric / v_cnt)::integer else 0 end;

  return query select v_tot, v_cnt, v_avg;
end;
$$ language plpgsql stable;
