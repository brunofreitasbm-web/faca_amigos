-- Apuração da bonificação por operador/dia — Playground e Circuito (Parque Shopping)
-- Regras: docs/bonificacao/programa-bonificacao-set-2026.md
-- Somente leitura. Ajuste o período em `params` (business_date, já com o corte de 4h).
--
-- Fonte única: kiosk (fa_kiosk_orders PAGA + fa_kiosk_sessions.checkin_by_employee_id).
-- Receita por operador = soma dos pedidos PAGA distintos das sessões que ele fez check-in
-- (irmãos no mesmo pedido contam uma vez). Produtos = pedidos fechados pelo operador.
-- Travas: caixa aberto até 10h15 e fechamento sem divergência > R$ 20 sem justificativa.
--
-- Metas, teto do mês e valores de bônus NÃO estão mais fixos aqui: vêm de
-- fa_kiosk_bonus_program_goals/fa_kiosk_bonus_program_config, configurados
-- pelo Owner em Gerencial > Metas (mesma fonte que
-- apps/kiosk-ui/src/lib/apuracaoBonificacao.ts usa no cliente para o menu
-- "Minha Bonificação" e a aba Gerencial > Bonificação). Isso garante que o
-- número que o operador vê no app é sempre o mesmo que este script apura
-- para a folha — uma unidade sem nada configurado nessas duas tabelas
-- simplesmente não gera bônus. Owner/ADMIN fica fora da apuração.
--
-- Bônus de Planos Longos (2 horas, Day Use, Porto Seguro): bônus fixo por unidade
-- vendida, escada mensal e teto próprio (fa_kiosk_bonus_program_config.planos_teto_mes_cents),
-- SEM as travas de caixa. Regras em fa_kiosk_bonus_plan_rules. Aparece nas colunas
-- planos_2h / pacotes / bonus_planos desta consulta (por dia, sem escada nem teto)
-- e, com escada e teto do mês, na segunda consulta ao final do arquivo
-- ("Resumo mensal — planos longos"). Mesma lógica de
-- apps/kiosk-ui/src/lib/apuracaoBonificacao.ts.
--
-- Aluguel avulso de pelúcia no Playground (fa_kiosk_sessions.rental_kind,
-- migrations 20260919120*): NÃO é sessão para a meta — fica fora de
-- `sessoes`, `sessoes_1h_mais` e do faturamento (inclusive quando fecha
-- no mesmo pedido de um irmão). Conta como 1 produto para quem fechou o
-- pedido, com o bônus baixo de produto (R$ 2) independente do preço, e
-- soma na meta de itens do mês. O excedente de tempo não vira item.

with params as (
  select date '2026-08-28' as d_from, date '2026-09-02' as d_to
),
units as (
  select id, name,
         case when kind = 'QUIOSQUE' then 'CIRCUITO' else 'PLAYGROUND' end as tipo
  from fa_kiosk_units
  where id in ('11111111-1111-1111-1111-111111111111',   -- Faça Amigos Playground (Parque Shopping)
               'e43ba7a8-bd5f-47ad-b81d-dae7ea19d504')   -- Faça Amigos Circuito (Parque Shopping)
),
goals as (
  select g.unit_id, g.weekday, g.meta_valor, g.super_valor, g.meta_bonus_cents, g.super_bonus_cents
  from fa_kiosk_bonus_program_goals g
  where g.unit_id in (select id from units)
),
config as (
  select cf.unit_id, cf.teto_mes_cents, cf.produto_preco_corte_cents, cf.produto_bonus_baixo_cents,
         cf.produto_bonus_alto_cents, cf.itens_mes_meta, cf.itens_mes_bonus_cents,
         cf.sessao_1h_percentual_min, cf.sessao_1h_bonus_cents, cf.locacao_extra_bonus_cents
  from fa_kiosk_bonus_program_config cf
  where cf.unit_id in (select id from units)
),
sess as (
  select s.unit_id, s.business_date, s.checkin_by_employee_id as employee_id, s.id as session_id, s.order_id,
         s.rental_kind, s.plan_id, s.uses_package,
         case when p.duration_unit = 'HORA' then p.duration_value * 60 else p.duration_value end as plan_min
  from fa_kiosk_sessions s
  join params pr on s.business_date between pr.d_from and pr.d_to
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id in (select id from units)
    and not exists (select 1 from fa_kiosk_session_events e where e.session_id = s.id and e.kind = 'CANCELADA')
),
sess_real as (
  -- sessões que contam para a meta: tudo menos aluguel de pelúcia
  select * from sess where rental_kind is null
),
rental_items as (
  -- valor dos itens de aluguel (plano + excedente) por pedido, para tirar do
  -- faturamento quando a pelúcia fecha junto com uma sessão de verdade
  select oi.order_id, sum(oi.total_cents) as cents
  from fa_kiosk_order_items oi
  join sess s on s.session_id = oi.session_id and s.rental_kind is not null
  where oi.item_type = 'SESSAO'
  group by 1
),
sess_orders as (
  select distinct unit_id, business_date, employee_id, order_id from sess_real where order_id is not null
),
rev as (
  select so.unit_id, so.business_date, so.employee_id, sum(o.total_cents - coalesce(ri.cents, 0)) as fat_cents
  from sess_orders so
  join fa_kiosk_orders o on o.id = so.order_id and o.status = 'PAGA'
  left join rental_items ri on ri.order_id = o.id
  group by 1, 2, 3
),
sess_agg as (
  select unit_id, business_date, employee_id,
         count(*) as sessoes,
         count(*) filter (where plan_min >= 60) as sessoes_1h_mais
  from sess_real group by 1, 2, 3
),
prod_raw as (
  -- Preço de corte/valores do bônus vêm de `config`; unidade sem config
  -- (left join) cai no coalesce(...,0) abaixo e não gera bônus de produto.
  select o.unit_id, o.business_date, o.closed_by_employee_id as employee_id,
         sum(oi.quantity) as itens,
         sum(oi.total_cents) as prod_cents,
         sum(
           case when oi.unit_price_cents < coalesce(cf.produto_preco_corte_cents, 999999999)
                then coalesce(cf.produto_bonus_baixo_cents, 0)
                else coalesce(cf.produto_bonus_alto_cents, 0)
           end * oi.quantity
         ) as bonus_prod_cents
  from fa_kiosk_orders o
  join fa_kiosk_order_items oi on oi.order_id = o.id and oi.item_type = 'PRODUTO'
  join params pr on o.business_date between pr.d_from and pr.d_to
  left join config cf on cf.unit_id = o.unit_id
  where o.status = 'PAGA' and o.unit_id in (select id from units)
  group by 1, 2, 3
  union all
  -- aluguel de pelúcia: 1 item e bônus baixo fixo por aluguel pago
  select o.unit_id, o.business_date, o.closed_by_employee_id as employee_id,
         1 as itens,
         coalesce((select sum(oi.total_cents) from fa_kiosk_order_items oi
                    where oi.session_id = s.session_id and oi.item_type = 'SESSAO'), 0) as prod_cents,
         coalesce(cf.produto_bonus_baixo_cents, 0) as bonus_prod_cents
  from sess s
  join fa_kiosk_orders o on o.id = s.order_id and o.status = 'PAGA'
  left join config cf on cf.unit_id = o.unit_id
  where s.rental_kind is not null
),
prod as (
  select unit_id, business_date, employee_id,
         sum(itens) as itens, sum(prod_cents) as prod_cents, sum(bonus_prod_cents) as bonus_prod_cents
  from prod_raw
  group by 1, 2, 3
),
plan_rules as (
  select r.unit_id, r.kind, r.ref_id, r.label, r.bonus_cents
  from fa_kiosk_bonus_plan_rules r
  where r.active and r.unit_id in (select id from units)
),
planos_venda as (
  -- 2 horas: uma unidade por criança (sessão), pedido PAGA, sem saldo de pacote,
  -- para o operador do check-in.
  select s.unit_id, s.business_date, s.employee_id, r.kind, r.ref_id, r.bonus_cents
  from sess_real s
  join fa_kiosk_orders o on o.id = s.order_id and o.status = 'PAGA'
  join plan_rules r on r.unit_id = s.unit_id and r.kind = 'PLANO' and r.ref_id = s.plan_id
  where s.uses_package is not true and s.employee_id is not null
  union all
  -- Pacotes (Day Use, Porto Seguro): uma unidade por linha de guardian_packages,
  -- para quem vendeu (sold_by) ou, sem isso, quem fechou o pedido. Pedido estornado sai.
  select gp.unit_id, gp.business_date, coalesce(gp.sold_by_employee_id, o.closed_by_employee_id), r.kind, r.ref_id, r.bonus_cents
  from fa_kiosk_guardian_packages gp
  join params pr on gp.business_date between pr.d_from and pr.d_to
  join plan_rules r on r.unit_id = gp.unit_id and r.kind = 'PACOTE' and r.ref_id = gp.package_id
  left join fa_kiosk_orders o on o.id = gp.order_id
  where (gp.order_id is null or o.status = 'PAGA')
    and coalesce(gp.sold_by_employee_id, o.closed_by_employee_id) is not null
),
planos_dia as (
  select unit_id, business_date, employee_id,
         count(*) filter (where kind = 'PLANO') as planos_2h,
         count(*) filter (where kind = 'PACOTE') as pacotes,
         sum(bonus_cents) as bonus_planos_cents
  from planos_venda group by 1, 2, 3
),
shift_div as (
  -- divergência por meio de pagamento no fechamento e se cada diferença > R$ 20 tem justificativa
  select sh.id as shift_id, sh.unit_id, sh.business_date, sh.status, sh.opened_at_ms, sh.opened_by_employee_id,
         coalesce(sum(abs(coalesce((sh.declared_json ->> k.key)::bigint, 0) - coalesce((sh.expected_json ->> k.key)::bigint, 0))), 0) as diverg_cents,
         bool_or(abs(coalesce((sh.declared_json ->> k.key)::bigint, 0) - coalesce((sh.expected_json ->> k.key)::bigint, 0)) > 2000
                 and coalesce(sh.close_justifications_json ->> k.key, '') = '') as diverg_sem_justificativa
  from fa_kiosk_shifts sh
  join params pr on sh.business_date between pr.d_from and pr.d_to
  left join lateral (
    select jsonb_object_keys(coalesce(sh.expected_json, '{}'::jsonb) || coalesce(sh.declared_json, '{}'::jsonb)) as key
  ) k on true
  where sh.unit_id in (select id from units)
  group by sh.id, sh.unit_id, sh.business_date, sh.status, sh.opened_at_ms, sh.opened_by_employee_id
),
shifts_dia as (
  -- um resumo por unidade/dia. A hora de abertura é a do primeiro caixa aberto por um operador
  -- (caixa aberto pelo owner/ADMIN não conta: evita que um teste vire "abertura do dia").
  -- Em dias com troca de turno, quem abriu pode não ser quem fez os check-ins; a trava é do dia.
  select sd.unit_id, sd.business_date,
         min(to_timestamp(sd.opened_at_ms / 1000.0) at time zone 'America/Belem')
             filter (where e.role is distinct from 'ADMIN') as abertura,
         bool_and(sd.status = 'FECHADO') as fechado,
         sum(sd.diverg_cents) as diverg_cents,
         bool_or(coalesce(sd.diverg_sem_justificativa, false)) as diverg_sem_justificativa
  from shift_div sd
  left join fa_kiosk_employees e on e.id = sd.opened_by_employee_id
  group by 1, 2
),
dias as (
  select coalesce(r.unit_id, sa.unit_id, p.unit_id, pl.unit_id) as unit_id,
         coalesce(r.business_date, sa.business_date, p.business_date, pl.business_date) as business_date,
         coalesce(r.employee_id, sa.employee_id, p.employee_id, pl.employee_id) as employee_id,
         coalesce(r.fat_cents, 0) as fat_cents,
         coalesce(sa.sessoes, 0) as sessoes,
         coalesce(sa.sessoes_1h_mais, 0) as sessoes_1h_mais,
         coalesce(p.itens, 0) as itens,
         coalesce(p.prod_cents, 0) as prod_cents,
         coalesce(p.bonus_prod_cents, 0) as bonus_prod_cents,
         coalesce(pl.planos_2h, 0) as planos_2h,
         coalesce(pl.pacotes, 0) as pacotes,
         coalesce(pl.bonus_planos_cents, 0) as bonus_planos_cents
  from rev r
  full join sess_agg sa on sa.unit_id = r.unit_id and sa.business_date = r.business_date and sa.employee_id = r.employee_id
  full join prod p on p.unit_id = coalesce(r.unit_id, sa.unit_id) and p.business_date = coalesce(r.business_date, sa.business_date)
                  and p.employee_id = coalesce(r.employee_id, sa.employee_id)
  full join planos_dia pl on pl.unit_id = coalesce(r.unit_id, sa.unit_id, p.unit_id) and pl.business_date = coalesce(r.business_date, sa.business_date, p.business_date)
                  and pl.employee_id = coalesce(r.employee_id, sa.employee_id, p.employee_id)
),
calc as (
  select d.*, u.tipo, u.name as unidade, e.full_name as operador, e.role,
         extract(isodow from d.business_date)::int as dow,
         sd.abertura, sd.fechado, sd.diverg_cents, sd.diverg_sem_justificativa,
         -- meta/supermeta do dia da semana (fa_kiosk_bonus_program_goals) —
         -- null quando a unidade não tem meta configurada para esse dia.
         case when u.tipo = 'PLAYGROUND' then g.meta_valor end as meta_fat_cents,
         case when u.tipo = 'PLAYGROUND' then g.super_valor end as super_fat_cents,
         case when u.tipo = 'CIRCUITO' then g.meta_valor end as meta_loc,
         case when u.tipo = 'CIRCUITO' then g.super_valor end as super_loc,
         g.meta_bonus_cents, g.super_bonus_cents,
         cf.sessao_1h_percentual_min, cf.sessao_1h_bonus_cents, cf.locacao_extra_bonus_cents,
         cf.itens_mes_meta, cf.itens_mes_bonus_cents, cf.teto_mes_cents
  from dias d
  join units u on u.id = d.unit_id
  join fa_kiosk_employees e on e.id = d.employee_id
  left join shifts_dia sd on sd.unit_id = d.unit_id and sd.business_date = d.business_date
  left join goals g on g.unit_id = d.unit_id and g.weekday = extract(isodow from d.business_date)::int
  left join config cf on cf.unit_id = d.unit_id
  where e.role <> 'ADMIN'
),
bonus as (
  select c.*,
         coalesce(c.abertura::time <= case when extract(isodow from c.business_date)::int = 7 then time '12:15' else time '10:15' end, false) as trava_abertura_ok,
         (coalesce(c.fechado, false) and not coalesce(c.diverg_sem_justificativa, false)) as trava_caixa_ok,
         case
           -- sem meta configurada pra esse dia/unidade: zero, nunca um valor adivinhado
           when c.meta_bonus_cents is null then 0
           when c.tipo = 'PLAYGROUND' then
             case when c.fat_cents >= c.super_fat_cents then c.super_bonus_cents
                  when c.fat_cents >= c.meta_fat_cents  then c.meta_bonus_cents
                  else 0 end
             + case when c.sessoes > 0
                         and c.sessoes_1h_mais::numeric / c.sessoes >= coalesce(c.sessao_1h_percentual_min, 0) / 100.0
                    then coalesce(c.sessao_1h_bonus_cents, 0) else 0 end
           when c.tipo = 'CIRCUITO' then
             case when c.sessoes >= c.super_loc then c.super_bonus_cents
                  when c.sessoes >= c.meta_loc  then c.meta_bonus_cents
                  else 0 end
             + greatest(c.sessoes - c.meta_loc, 0) * coalesce(c.locacao_extra_bonus_cents, 0)
           else 0
         end as bonus_meta_cents
  from calc c
),
final as (
  select b.*,
         case when trava_abertura_ok and trava_caixa_ok then bonus_meta_cents + bonus_prod_cents else 0 end as bonus_dia_cents,
         sum(itens) over (partition by employee_id, date_trunc('month', business_date)) as itens_mes
  from bonus b
)
select unidade, operador, business_date as dia, to_char(business_date, 'Dy') as sem,
       round(fat_cents / 100.0, 2) as faturamento,
       sessoes, sessoes_1h_mais,
       round(coalesce(meta_fat_cents, meta_loc * 100) / 100.0, 2) as meta,
       itens as produtos, round(prod_cents / 100.0, 2) as produtos_rs,
       to_char(abertura, 'HH24:MI') as abertura, round(coalesce(diverg_cents, 0) / 100.0, 2) as divergencia,
       trava_abertura_ok, trava_caixa_ok,
       round(bonus_meta_cents / 100.0, 2) as bonus_meta,
       round(bonus_prod_cents / 100.0, 2) as bonus_produtos,
       planos_2h, pacotes, round(bonus_planos_cents / 100.0, 2) as bonus_planos,
       round(bonus_dia_cents / 100.0, 2) as bonus_dia,
       -- acumulado do mês com o teto configurado (fa_kiosk_bonus_program_config),
       -- incluindo o bônus de bater a meta de itens vendidos no mês. Sem teto
       -- configurado (0/null), usa um teto "infinito" (999999999) — não trava nada.
       round(least(
         sum(bonus_dia_cents) over (partition by employee_id, date_trunc('month', business_date)
                                    order by business_date rows between unbounded preceding and current row)
         + case when coalesce(itens_mes_meta, 0) > 0 and itens_mes >= itens_mes_meta then coalesce(itens_mes_bonus_cents, 0) else 0 end,
         case when coalesce(teto_mes_cents, 0) > 0 then teto_mes_cents else 999999999 end
       ) / 100.0, 2) as acumulado_mes_com_teto
from final
order by unidade, business_date, operador
;

-- ---------------------------------------------------------------------------
-- Resumo mensal — planos longos (escada e teto próprio, por operador e regra)
-- Rode com o mesmo período da consulta acima, ajustando as datas em `params`.
-- O bônus dos planos NÃO passa pelas travas de caixa e NÃO entra no teto de
-- metas/produtos (fa_kiosk_bonus_program_config.teto_mes_cents): tem teto
-- próprio (planos_teto_mes_cents; 0/null = sem teto).
-- ---------------------------------------------------------------------------
with params as (
  select date '2026-10-06' as d_from, date '2026-11-05' as d_to
),
units as (
  select id from fa_kiosk_units
  where id in ('11111111-1111-1111-1111-111111111111', 'e43ba7a8-bd5f-47ad-b81d-dae7ea19d504')
),
plan_rules as (
  select r.* from fa_kiosk_bonus_plan_rules r where r.active and r.unit_id in (select id from units)
),
vendas as (
  select s.unit_id, s.checkin_by_employee_id as employee_id, r.kind, r.ref_id
  from fa_kiosk_sessions s
  join params pr on s.business_date between pr.d_from and pr.d_to
  join fa_kiosk_orders o on o.id = s.order_id and o.status = 'PAGA'
  join plan_rules r on r.unit_id = s.unit_id and r.kind = 'PLANO' and r.ref_id = s.plan_id
  where s.rental_kind is null and s.uses_package is not true and s.checkin_by_employee_id is not null
    and not exists (select 1 from fa_kiosk_session_events e where e.session_id = s.id and e.kind = 'CANCELADA')
  union all
  select gp.unit_id, coalesce(gp.sold_by_employee_id, o.closed_by_employee_id), r.kind, r.ref_id
  from fa_kiosk_guardian_packages gp
  join params pr on gp.business_date between pr.d_from and pr.d_to
  join plan_rules r on r.unit_id = gp.unit_id and r.kind = 'PACOTE' and r.ref_id = gp.package_id
  left join fa_kiosk_orders o on o.id = gp.order_id
  where (gp.order_id is null or o.status = 'PAGA')
    and coalesce(gp.sold_by_employee_id, o.closed_by_employee_id) is not null
),
por_regra as (
  select v.unit_id, v.employee_id, r.label, r.bonus_cents, r.escada_meta, r.escada_bonus_cents, r.sort_order,
         count(*) as qtd
  from vendas v
  join plan_rules r on r.unit_id = v.unit_id and r.kind = v.kind and r.ref_id = v.ref_id
  group by 1, 2, 3, 4, 5, 6, 7
),
calc as (
  select pr.*, pr.qtd * pr.bonus_cents as unitario_cents,
         case when pr.escada_meta > 0 and pr.qtd >= pr.escada_meta then pr.escada_bonus_cents else 0 end as escada_cents
  from por_regra pr
)
select u.name as unidade, e.full_name as operador, c.label as regra, c.qtd,
       round(c.unitario_cents / 100.0, 2) as bonus_unitario,
       c.escada_meta, round(c.escada_cents / 100.0, 2) as bonus_escada,
       round(sum(c.unitario_cents + c.escada_cents) over (partition by c.unit_id, c.employee_id) / 100.0, 2) as total_antes_do_teto,
       round(least(
         sum(c.unitario_cents + c.escada_cents) over (partition by c.unit_id, c.employee_id),
         case when coalesce(cf.planos_teto_mes_cents, 0) > 0 then cf.planos_teto_mes_cents else 999999999 end
       ) / 100.0, 2) as total_planos_com_teto
from calc c
join fa_kiosk_units u on u.id = c.unit_id
join fa_kiosk_employees e on e.id = c.employee_id and e.role <> 'ADMIN'
left join fa_kiosk_bonus_program_config cf on cf.unit_id = c.unit_id
order by unidade, operador, c.sort_order;
