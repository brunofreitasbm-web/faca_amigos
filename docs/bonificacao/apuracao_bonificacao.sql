-- Apuração da bonificação por operador/dia — Playground e Circuito (Parque Shopping)
-- Regras: docs/bonificacao/programa-bonificacao-set-2026.md
-- Somente leitura. Ajuste o período em `params` (business_date, já com o corte de 4h).
--
-- Fonte única: kiosk (fa_kiosk_orders PAGA + fa_kiosk_sessions.checkin_by_employee_id).
-- Receita por operador = soma dos pedidos PAGA distintos das sessões que ele fez check-in
-- (irmãos no mesmo pedido contam uma vez). Produtos = pedidos fechados pelo operador.
-- Travas: caixa aberto até 10h15 e fechamento sem divergência > R$ 20 sem justificativa.
-- Teto: R$ 200/mês por operador (inclui produtos). Owner/ADMIN fica fora.

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
sess as (
  select s.unit_id, s.business_date, s.checkin_by_employee_id as employee_id, s.id as session_id, s.order_id,
         case when p.duration_unit = 'HORA' then p.duration_value * 60 else p.duration_value end as plan_min
  from fa_kiosk_sessions s
  join params pr on s.business_date between pr.d_from and pr.d_to
  left join fa_kiosk_plans p on p.id = s.plan_id
  where s.unit_id in (select id from units)
    and not exists (select 1 from fa_kiosk_session_events e where e.session_id = s.id and e.kind = 'CANCELADA')
),
sess_orders as (
  select distinct unit_id, business_date, employee_id, order_id from sess where order_id is not null
),
rev as (
  select so.unit_id, so.business_date, so.employee_id, sum(o.total_cents) as fat_cents
  from sess_orders so
  join fa_kiosk_orders o on o.id = so.order_id and o.status = 'PAGA'
  group by 1, 2, 3
),
sess_agg as (
  select unit_id, business_date, employee_id,
         count(*) as sessoes,
         count(*) filter (where plan_min >= 60) as sessoes_1h_mais
  from sess group by 1, 2, 3
),
prod as (
  select o.unit_id, o.business_date, o.closed_by_employee_id as employee_id,
         sum(oi.quantity) as itens,
         sum(oi.total_cents) as prod_cents,
         sum(case when oi.unit_price_cents < 4000 then 200 else 400 end * oi.quantity) as bonus_prod_cents
  from fa_kiosk_orders o
  join fa_kiosk_order_items oi on oi.order_id = o.id and oi.item_type = 'PRODUTO'
  join params pr on o.business_date between pr.d_from and pr.d_to
  where o.status = 'PAGA' and o.unit_id in (select id from units)
  group by 1, 2, 3
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
  select coalesce(r.unit_id, sa.unit_id, p.unit_id) as unit_id,
         coalesce(r.business_date, sa.business_date, p.business_date) as business_date,
         coalesce(r.employee_id, sa.employee_id, p.employee_id) as employee_id,
         coalesce(r.fat_cents, 0) as fat_cents,
         coalesce(sa.sessoes, 0) as sessoes,
         coalesce(sa.sessoes_1h_mais, 0) as sessoes_1h_mais,
         coalesce(p.itens, 0) as itens,
         coalesce(p.prod_cents, 0) as prod_cents,
         coalesce(p.bonus_prod_cents, 0) as bonus_prod_cents
  from rev r
  full join sess_agg sa on sa.unit_id = r.unit_id and sa.business_date = r.business_date and sa.employee_id = r.employee_id
  full join prod p on p.unit_id = coalesce(r.unit_id, sa.unit_id) and p.business_date = coalesce(r.business_date, sa.business_date)
                  and p.employee_id = coalesce(r.employee_id, sa.employee_id)
),
calc as (
  select d.*, u.tipo, u.name as unidade, e.full_name as operador, e.role,
         extract(isodow from d.business_date)::int as dow,
         sd.abertura, sd.fechado, sd.diverg_cents, sd.diverg_sem_justificativa,
         -- metas por dia da semana (1=seg ... 7=dom)
         case u.tipo when 'PLAYGROUND' then
           case when extract(isodow from d.business_date) <= 4 then 90000 when extract(isodow from d.business_date) = 5 then 150000
                when extract(isodow from d.business_date) = 6 then 240000 else 220000 end end as meta_fat_cents,
         case u.tipo when 'PLAYGROUND' then
           case when extract(isodow from d.business_date) <= 4 then 110000 when extract(isodow from d.business_date) = 5 then 180000
                when extract(isodow from d.business_date) = 6 then 280000 else 260000 end end as super_fat_cents,
         case u.tipo when 'CIRCUITO' then
           case when extract(isodow from d.business_date) <= 4 then 8 when extract(isodow from d.business_date) = 5 then 10
                when extract(isodow from d.business_date) = 6 then 22 else 30 end end as meta_loc,
         case u.tipo when 'CIRCUITO' then
           case when extract(isodow from d.business_date) <= 4 then 10 when extract(isodow from d.business_date) = 5 then 12
                when extract(isodow from d.business_date) = 6 then 27 else 35 end end as super_loc
  from dias d
  join units u on u.id = d.unit_id
  join fa_kiosk_employees e on e.id = d.employee_id
  left join shifts_dia sd on sd.unit_id = d.unit_id and sd.business_date = d.business_date
  where e.role <> 'ADMIN'
),
bonus as (
  select c.*,
         coalesce(c.abertura::time <= time '10:15', false) as trava_abertura_ok,
         (coalesce(c.fechado, false) and not coalesce(c.diverg_sem_justificativa, false)) as trava_caixa_ok,
         case c.tipo
           when 'PLAYGROUND' then
             case when c.fat_cents >= c.super_fat_cents then (case when c.dow <= 4 then 1200 else 1600 end)
                  when c.fat_cents >= c.meta_fat_cents  then (case when c.dow <= 4 then 800  else 1200 end)
                  else 0 end
             + case when c.sessoes > 0 and c.sessoes_1h_mais::numeric / c.sessoes >= 0.45 then 200 else 0 end
           when 'CIRCUITO' then
             case when c.sessoes >= c.super_loc then (case when c.dow <= 4 then 1000 else 1600 end)
                  when c.sessoes >= c.meta_loc  then (case when c.dow <= 4 then 600  else 1000 end)
                  else 0 end
             + greatest(c.sessoes - c.meta_loc, 0) * 100
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
       round(bonus_dia_cents / 100.0, 2) as bonus_dia,
       -- acumulado do mês com teto de R$ 200 (inclui +R$ 10 da meta de 10 produtos no mês)
       round(least(
         sum(bonus_dia_cents) over (partition by employee_id, date_trunc('month', business_date)
                                    order by business_date rows between unbounded preceding and current row)
         + case when itens_mes >= 10 then 1000 else 0 end,
         20000) / 100.0, 2) as acumulado_mes_com_teto
from final
order by unidade, business_date, operador;
