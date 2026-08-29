-- Migration: Atualiza fa_kiosk_today_revenue e fa_kiosk_today_ticket_medio com fallback para fa_kiosk_sessions
-- Garante que unidades com sessões ativas/registradas no dia (como Faça Amigos Circuito) computem faturamento e ticket médio reais,
-- mesmo quando pedidos formais em fa_kiosk_orders ainda não tiverem sido finalizados ou forem contabilizados por sessão.

create or replace function fa_kiosk_today_revenue(p_unit_id uuid, p_business_date text) returns integer as $$
declare
  v_orders_cents integer := 0;
  v_sessions_cents integer := 0;
begin
  select coalesce(sum(total_cents), 0)::integer into v_orders_cents
  from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA';

  select coalesce(sum(
    greatest(0, coalesce(s.package_price_cents, p.price_cents, 0) - coalesce(s.coupon_discount_cents, 0))
  ), 0)::integer into v_sessions_cents
  from fa_kiosk_sessions s
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id = p_unit_id
    and s.business_date = p_business_date::date
    and s.status <> 'CANCELADA';

  return greatest(v_orders_cents, v_sessions_cents);
end;
$$ language plpgsql stable;

create or replace function fa_kiosk_today_ticket_medio(p_unit_id uuid, p_business_date text)
returns table(total_cents integer, orders_count integer, avg_cents integer) as $$
declare
  v_orders_cents integer := 0;
  v_orders_count integer := 0;
  v_sessions_cents integer := 0;
  v_sessions_count integer := 0;
  v_tot integer := 0;
  v_cnt integer := 0;
  v_avg integer := 0;
begin
  select coalesce(sum(total_cents), 0)::integer, count(*)::integer
  into v_orders_cents, v_orders_count
  from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA';

  select
    coalesce(sum(greatest(0, coalesce(s.package_price_cents, p.price_cents, 0) - coalesce(s.coupon_discount_cents, 0))), 0)::integer,
    count(*)::integer
  into v_sessions_cents, v_sessions_count
  from fa_kiosk_sessions s
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id = p_unit_id
    and s.business_date = p_business_date::date
    and s.status <> 'CANCELADA';

  if v_orders_cents >= v_sessions_cents and v_orders_count > 0 then
    v_tot := v_orders_cents;
    v_cnt := v_orders_count;
  else
    v_tot := greatest(v_orders_cents, v_sessions_cents);
    v_cnt := greatest(v_orders_count, v_sessions_count);
  end if;

  v_avg := case when v_cnt > 0 then round(v_tot::numeric / v_cnt)::integer else 0 end;

  return query select v_tot, v_cnt, v_avg;
end;
$$ language plpgsql stable;
