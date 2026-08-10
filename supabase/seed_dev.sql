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
  admin_user as (
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'admin-dev@kiosk.internal', crypt('000000', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, now(), now()
    ) returning id
  ),
  admin_emp as (
    insert into fa_kiosk_employees (auth_user_id, full_name, role, active)
    select id, 'Admin Dev', 'ADMIN', true from admin_user returning id
  ),
  admin_cred as (
    insert into fa_kiosk_local_credentials (employee_id, pin_hash)
    select id, crypt('000000', gen_salt('bf')) from admin_emp returning employee_id
  ),
  admin2_user as (
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'admin2@kiosk.internal', crypt('000000', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, now(), now()
    ) returning id
  ),
  admin2_emp as (
    insert into fa_kiosk_employees (auth_user_id, full_name, role, active)
    select id, 'Admin 2', 'ADMIN', true from admin2_user returning id
  ),
  admin2_cred as (
    insert into fa_kiosk_local_credentials (employee_id, pin_hash)
    select id, crypt('000000', gen_salt('bf')) from admin2_emp returning employee_id
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
    select id, 'Buggy Azul', '🏎️', '#2ECFB5', 200 from circuito
    union all
    select id, 'Moto Verde', '🏍️', '#1A3F35', 200 from circuito
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
  ),
  -- Pacotes de upgrade (motor de cross-selling). Os valores foram
  -- escolhidos para funcionar como escada de ancoragem sobre os planos
  -- avulsos acima: o avulso de 1 hora custa R$ 60/h, e cada pacote baixa
  -- o custo/hora conforme sobe de degrau (R$ 50 → 45 → 40). O motor só
  -- oferece pacote que reduz o custo/hora do cliente, então uma escada
  -- que não desce nunca apareceria no balcão.
  packages_seed as (
    insert into fa_kiosk_packages (unit_id, activity, name, price_cents, included_minutes, validity_days, benefit_text, color, sort_order)
    select id, 'PLAYGROUND', 'Pacote Amigo 5h', 25000, 300, 30, '5 horas de brincadeira para usar quando quiser', '#2ECFB5', 1 from playground
    union all
    select id, 'PLAYGROUND', 'Pacote Amigão 10h', 45000, 600, 30, '10 horas mais uma meia antiderrapante de brinde', '#FF7A00', 2 from playground
    union all
    select id, 'PLAYGROUND', 'Pacote Melhores Amigos 20h', 80000, 1200, 60, '20 horas, 60 dias de validade e prioridade no Cantinho da Calma', '#A020EE', 3 from playground
    union all
    select id, 'PLAYGROUND', 'Pacote Amigo 5h', 25000, 300, 30, '5 horas de brincadeira para usar quando quiser', '#2ECFB5', 1 from grao_para
    union all
    select id, 'PLAYGROUND', 'Pacote Amigão 10h', 45000, 600, 30, '10 horas mais uma meia antiderrapante de brinde', '#FF7A00', 2 from grao_para
    union all
    select id, 'CARRINHO', 'Pacote Circuito 3h', 30000, 180, 30, '3 horas de circuito com o carrinho preferido reservado', '#2ECFB5', 1 from circuito
    returning 1
  )
select 'seed ok' as status;
