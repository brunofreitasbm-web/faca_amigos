-- =====================================================================
-- Correção: fa_guardian_month_consumption referenciava coluna inexistente
-- =====================================================================
-- fa_kiosk_orders nunca teve uma coluna created_at_ms (só created_at
-- timestamptz e closed_at_ms bigint). A migration 20260807000008 usou
-- `coalesce(o.closed_at_ms, o.created_at_ms)`, o que derrubava
-- fa_upsell_offer com "column o.created_at_ms does not exist" (400 na
-- tela de Entrada, sempre que o gasto do mês precisava ser somado).
--
-- Corrigido para derivar o fallback de created_at (timestamptz) quando
-- closed_at_ms está nulo.

create or replace function fa_guardian_month_consumption(
  p_unit_id uuid, p_guardian_id uuid, p_now_ms bigint default null
) returns jsonb as $$
declare
  v_now_ms bigint := coalesce(p_now_ms, (extract(epoch from now()) * 1000)::bigint);
  v_from_ms bigint := fa_kiosk_month_start_ms(p_unit_id, v_now_ms);
  v_spend integer := 0;
  v_minutes integer := 0;
  v_visits integer := 0;
begin
  select coalesce(sum(oi.total_cents), 0)::integer
    into v_spend
    from fa_kiosk_order_items oi
    join fa_kiosk_orders o on o.id = oi.order_id
    join fa_kiosk_sessions s on s.id = oi.session_id
   where s.guardian_id = p_guardian_id
     and o.unit_id = p_unit_id
     and o.status = 'PAGA'
     and coalesce(o.closed_at_ms, (extract(epoch from o.created_at) * 1000)::bigint) >= v_from_ms
     and coalesce(o.closed_at_ms, (extract(epoch from o.created_at) * 1000)::bigint) <= v_now_ms;

  select coalesce(sum(greatest(1, ceil(
           (s.checkout_at_ms - s.checkin_at_ms - coalesce(s.paused_ms_total, 0)) / 60000.0))), 0)::integer,
         count(*)::integer
    into v_minutes, v_visits
    from fa_kiosk_sessions s
   where s.guardian_id = p_guardian_id
     and s.unit_id = p_unit_id
     and s.status = 'FINALIZADA'
     and s.checkout_at_ms is not null
     and s.checkin_at_ms >= v_from_ms
     and s.checkin_at_ms <= v_now_ms;

  return jsonb_build_object(
    'fromMs', v_from_ms,
    'spendCents', v_spend,
    'consumedMinutes', v_minutes,
    'sessions', v_visits);
end;
$$ language plpgsql stable security definer;
