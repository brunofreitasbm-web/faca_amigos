-- Relatório "Tipos de Plano × Quantidade vendida".
--
-- Vira RPC pelo mesmo motivo das funções em 20260806000015: é JOIN +
-- GROUP BY, que o query builder do supabase-js não expressa — a
-- alternativa seria puxar todas as sessões do mês para o cliente só para
-- contá-las.
--
-- Conta sessões, não itens de pedido: o plano é escolhido e cobrado no
-- check-in, então cada sessão é uma venda de plano. fa_kiosk_order_items
-- não serviria — não tem plan_id, só a descrição em texto livre.
-- Sessões não têm status de cancelamento (só ATIVA / AGUARDANDO_PAGAMENTO
-- / FINALIZADA), então nenhuma precisa ser excluída da contagem.

create or replace function fa_kiosk_plans_sold(p_unit_id uuid, p_from date, p_to date) returns table (
  plan_id uuid, plan_name text, plan_color text, activity text, sessions_count bigint
) as $$
  select p.id, p.name, p.color, p.activity, count(s.id)
  from fa_kiosk_sessions s
  join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id = p_unit_id
    and s.business_date >= p_from
    and s.business_date <= p_to
  group by p.id, p.name, p.color, p.activity
  order by count(s.id) desc, p.name
$$ language sql stable;
