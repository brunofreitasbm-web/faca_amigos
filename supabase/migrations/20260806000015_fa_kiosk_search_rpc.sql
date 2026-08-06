-- Fase 7: as duas consultas de apoio ao check-in que ainda restavam no
-- servidor local (autocomplete de criança, último carrinho usado) e o
-- total do dia — todas somente leitura, viram função por causa do
-- JOIN + OR + GROUP BY que o query builder do supabase-js não expressa bem.

create or replace function fa_kiosk_search_children(p_query text) returns table (
  id uuid, full_name text, birth_date date, phone_e164 text, guardian_name text, cpf text
) as $$
  select c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name as guardian_name, g.cpf
  from fa_kiosk_children c
  left join fa_kiosk_child_guardians cg on cg.child_id = c.id
  left join fa_kiosk_guardians g on g.id = cg.guardian_id
  where c.full_name ilike '%' || p_query || '%' or g.phone_e164 ilike '%' || p_query || '%'
     or g.cpf ilike '%' || p_query || '%' or g.full_name ilike '%' || p_query || '%'
  group by c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name, g.cpf
  order by c.full_name
  limit 10
$$ language sql stable;

create or replace function fa_kiosk_last_asset_for_child(p_child_id uuid) returns uuid as $$
  select asset_id from fa_kiosk_sessions
  where child_id = p_child_id and asset_id is not null
  order by checkin_at_ms desc limit 1
$$ language sql stable;

create or replace function fa_kiosk_today_revenue(p_unit_id uuid, p_business_date text) returns integer as $$
  select coalesce(sum(total_cents), 0)::integer from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA'
$$ language sql stable;
