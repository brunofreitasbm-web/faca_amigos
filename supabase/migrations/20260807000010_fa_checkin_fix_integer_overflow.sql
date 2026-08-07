-- =====================================================================
-- Correção de Integer Overflow em fa_kiosk_visit_tier
-- =====================================================================
-- A expressão `60 * 24 * 60 * 60000` (60 dias em milissegundos) usada
-- na verificação de visitas recentes resultava em 5.184.000.000, o que
-- ultrapassa o limite do tipo `integer` (32 bits) no PostgreSQL.
-- Como todos os operandos eram literais inteiros, o Postgres avaliava a
-- multiplicação como `integer` e lançava o erro "integer out of range"
-- antes mesmo da função rodar, quebrando as chamadas de checkin.
--
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
