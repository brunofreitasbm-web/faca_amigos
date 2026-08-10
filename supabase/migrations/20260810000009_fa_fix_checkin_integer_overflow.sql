-- =====================================================================
-- Correção definitiva do Integer Overflow na RPC fa_checkin / fa_kiosk_visit_tier
-- =====================================================================
-- A expressão `60 * 24 * 60 * 60000` (60 dias em milissegundos) estoura o
-- limite de integer (32-bit: 2.147.483.647) no PostgreSQL, gerando o erro
-- 22003 (integer out of range) que causa HTTP 400 (Bad Request) no Supabase PostgREST.
-- Substituído por `5184000000` (bigint).

create or replace function fa_kiosk_visit_tier(p_child_id uuid, p_now_ms bigint) returns jsonb as $$
declare
  total_visits integer;
  recent_visits integer;
begin
  select count(*) into total_visits from fa_kiosk_visit_log where child_id = p_child_id;
  if total_visits = 0 then return null; end if;

  select count(*) into recent_visits from fa_kiosk_visit_log
    where child_id = p_child_id and (p_now_ms - at_ms) <= 5184000000;

  if recent_visits > 8 then
    return jsonb_build_object('tier', 'VIP', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('VIP — %s visitas', total_visits), 'blink', false);
  elsif recent_visits > 3 then
    return jsonb_build_object('tier', 'FREQUENTE', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('%s visitas', total_visits), 'blink', true);
  else
    return jsonb_build_object('tier', 'RECORRENTE', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('%s visita%s', total_visits, case when total_visits > 1 then 's' else '' end), 'blink', false);
  end if;
end;
$$ language plpgsql stable;
