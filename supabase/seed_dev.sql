-- Seed de desenvolvimento para testar o kiosk-ui publicado, baseado nos
-- mesmos dados de apps/kiosk/src/server/seed-dev.ts (usado antes só no
-- SQLite local). Rode uma vez no SQL Editor do Supabase.

with
  playground as (
    insert into fa_kiosk_units (kind, name) values ('LOJA', 'Playground (Parque Shopping)') returning id
  ),
  circuito as (
    insert into fa_kiosk_units (kind, name) values ('QUIOSQUE', 'Circuito (Parque Shopping)') returning id
  ),
  grao_para as (
    insert into fa_kiosk_units (kind, name) values ('LOJA', 'Playground (Bosque Grão-Pará)') returning id
  ),
  admin_emp as (
    insert into fa_kiosk_employees (full_name, role, active) values ('Admin Dev', 'ADMIN', true) returning id
  ),
  plans_playground as (
    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color)
    select id, 'PLAYGROUND', '30 minutos', 4000, 30, 'MINUTO', 150, '#2ECFB5' from playground
    union all
    select id, 'PLAYGROUND', '1 hora', 6000, 1, 'HORA', 150, '#F0196B' from playground
    union all
    select id, 'PLAYGROUND', 'Day Use (5h)', 27000, 5, 'HORA', 180, '#A020EE' from playground
    returning 1
  ),
  plans_circuito as (
    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color)
    select id, 'CARRINHO', '15 minutos', 3000, 15, 'MINUTO', 100, '#2ECFB5' from circuito
    union all
    select id, 'CARRINHO', '30 minutos', 5500, 30, 'MINUTO', 100, '#FFE234' from circuito
    returning 1
  ),
  plans_grao_para as (
    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color)
    select id, 'PLAYGROUND', '30 minutos', 4000, 30, 'MINUTO', 150, '#2ECFB5' from grao_para
    union all
    select id, 'PLAYGROUND', '1 hora', 6000, 1, 'HORA', 150, '#F0196B' from grao_para
    union all
    select id, 'PLAYGROUND', 'Day Use (5h)', 27000, 5, 'HORA', 180, '#A020EE' from grao_para
    returning 1
  ),
  products_seed as (
    insert into fa_kiosk_products (unit_id, name, description, emoji, price_cents, stock)
    select id, 'Água mineral', 'Garrafa 500ml', '💧', 500, 40 from playground
    union all
    select id, 'Meia antiderrapante', 'Tamanho único infantil', '🧦', 1500, 25 from playground
    union all
    select id, 'Água mineral', 'Garrafa 500ml', '💧', 500, 50 from grao_para
    union all
    select id, 'Meia antiderrapante', 'Tamanho único infantil', '🧦', 1500, 35 from grao_para
    union all
    select id, 'Suco de Fruta', 'Caixinha 200ml', '🧃', 700, 30 from grao_para
    returning 1
  ),
  assets_seed as (
    insert into fa_kiosk_assets (unit_id, name, emoji, color, maintenance_threshold_hours)
    select id, 'Jipe Rosa', '🚙', '#F0196B', 200 from circuito
    union all
    select id, 'Fusca Amarelo', '🚗', '#FFE234', 200 from circuito
    returning 1
  ),
  coupons_seed as (
    insert into fa_kiosk_coupons (unit_id, code, kind, value, max_uses, description)
    select id, 'AMIGO10', 'MINUTOS_EXTRA', 10, 0, '10 minutos extras — avaliação no Google' from playground
    union all
    select id, 'GRAOPARA10', 'MINUTOS_EXTRA', 10, 0, '10 minutos extras — inauguração Grão-Pará' from grao_para
    returning 1
  ),
  loyalty_seed as (
    insert into fa_kiosk_loyalty_rules (unit_id, activity, trigger_visits, reward_kind, reward_value)
    select id, 'PLAYGROUND', 10, 'ENTRADA_GRATIS', 1 from playground
    union all
    select id, 'PLAYGROUND', 10, 'ENTRADA_GRATIS', 1 from grao_para
    returning 1
  )
select 'seed ok' as status;
