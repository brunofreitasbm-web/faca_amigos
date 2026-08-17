-- Meta de Ticket Médio por unidade — mínimo e alvo desejado, configurável
-- só pelo Owner (ADMIN), usada no termômetro do Painel para o operador
-- ver como o dia está indo em relação ao que o dono definiu.

create table if not exists fa_kiosk_unit_ticket_goals (
  unit_id uuid primary key references fa_kiosk_units (id),
  min_ticket_cents integer not null default 0,
  target_ticket_cents integer not null default 0,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_kiosk_unit_ticket_goals enable row level security;

-- Leitura aberta a qualquer colaborador autenticado: o termômetro no
-- Painel precisa da meta mesmo para quem não é Owner (só não pode editar).
create policy fa_kiosk_ticket_goals_read on fa_kiosk_unit_ticket_goals
  for select to authenticated using (true);

create policy fa_kiosk_ticket_goals_write on fa_kiosk_unit_ticket_goals
  for all to authenticated
  using (fa_kiosk_can('metas.ticket.write'))
  with check (fa_kiosk_can('metas.ticket.write'));

-- Capacidade nova, só concedida ao ADMIN — mesmo padrão de
-- 20260817160000_fa_restrict_session_cancel_to_owner.sql: meta financeira
-- da unidade é decisão de dono do negócio, não de quem opera o dia a dia.
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'metas.ticket.write')
on conflict do nothing;

-- Ticket médio de hoje: faturado / pedidos pagos, mesma fórmula já usada
-- no relatório de Acompanhamento (20260818000001_fa_kiosk_owner_reports.sql,
-- fa_owner_report_build_acompanhamento) — reaproveitada aqui como RPC de
-- leitura para o termômetro do Painel, no mesmo estilo simples de
-- fa_kiosk_today_revenue (20260806000015_fa_kiosk_search_rpc.sql).
create or replace function fa_kiosk_today_ticket_medio(p_unit_id uuid, p_business_date text)
returns table(total_cents integer, orders_count integer, avg_cents integer) as $$
  select
    coalesce(sum(total_cents), 0)::integer,
    count(*)::integer,
    case when count(*) > 0 then round(coalesce(sum(total_cents), 0)::numeric / count(*))::integer else 0 end
  from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA'
$$ language sql stable;
