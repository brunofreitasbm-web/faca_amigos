-- Selo do Painel mostrava só as visitas dos últimos 30 dias (ex.: "9 visitas"
-- para quem tem 31). fa_kiosk_vip_flags passa a devolver também o contador
-- absoluto (todas as linhas de fa_kiosk_visit_log da criança — a mesma
-- contagem do programa de fidelidade). O VIP continua decidido pela janela.
drop function if exists fa_kiosk_vip_flags(uuid, uuid[]);

create function fa_kiosk_vip_flags(p_unit_id uuid, p_child_ids uuid[])
returns table (child_id uuid, visits_in_window integer, is_vip boolean, total_visits integer) as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_days integer := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_window_days', 30);
  v_min integer := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_visits', 4);
begin
  return query
    select c.id,
           fa_kiosk_visits_in_window(c.id, v_now_ms, v_days),
           fa_kiosk_visits_in_window(c.id, v_now_ms, v_days) >= v_min,
           (select count(*)::integer from fa_kiosk_visit_log vl where vl.child_id = c.id)
      from unnest(coalesce(p_child_ids, array[]::uuid[])) as c(id);
end;
$$ language plpgsql stable security definer;

revoke execute on function fa_kiosk_vip_flags(uuid, uuid[]) from public, anon;
grant execute on function fa_kiosk_vip_flags(uuid, uuid[]) to authenticated, service_role;
