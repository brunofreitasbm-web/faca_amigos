-- Abertura do Playground (Bosque Grão-Pará): mesma tabela de preços, pacotes e descontos do
-- Playground do Parque Shopping. Idempotente (ids fixos + on conflict).
-- Não mexe em dados fiscais (já preenchidos em fa_kiosk_units) nem em closing_time:
-- o Grão-Pará fecha às 21h aos domingos e o closing_time atual é um único "HH:MM" por unidade.

-- Planos (preço de tabela; o desconto geral/inclusivo vem dos cupons abaixo, como no Parque).
insert into fa_kiosk_plans (id, unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active)
values
  ('7a1e0001-0000-4000-8000-000000000030', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', '30 minutos', 10000,  30, 'MINUTO', 300, '#2ECFB5', true),
  ('7a1e0001-0000-4000-8000-000000000060', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', '1 hora',     18000,  60, 'MINUTO', 300, '#F0196B', true),
  ('7a1e0001-0000-4000-8000-000000000120', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', '2 horas',    32000, 120, 'MINUTO', 300, '#FFE234', true)
on conflict (id) do update set
  value_cents = excluded.value_cents, duration_value = excluded.duration_value, duration_unit = excluded.duration_unit,
  overage_cents_per_minute = excluded.overage_cents_per_minute, color = excluded.color, active = true;

-- Pacotes: Passaporte mensal (PORTO SEGURO) e Day Use.
insert into fa_kiosk_packages (id, unit_id, activity, name, price_cents, included_minutes, validity_days, benefit_text, color, sort_order, active, created_at_ms, overage_cents_per_minute)
values
  ('7a1e0002-0000-4000-8000-000000000001', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', 'PORTO SEGURO', 140000, 600, 30, '.', '#1A3F35', 0, true, (extract(epoch from now()) * 1000)::bigint, 0),
  ('7a1e0002-0000-4000-8000-000000000002', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', 'DAY USE',      45000, 600,  1, '.', '#A020EE', 0, true, (extract(epoch from now()) * 1000)::bigint, 0)
on conflict (id) do update set
  price_cents = excluded.price_cents, included_minutes = excluded.included_minutes, validity_days = excluded.validity_days, active = true;

-- Descontos: 40% (público geral) e 50% (meia-entrada inclusiva), como no Parque.
insert into fa_kiosk_coupons (id, unit_id, code, kind, value, max_uses, used_count, active, description, created_at_ms)
values
  ('7a1e0003-0000-4000-8000-000000000040', '5fc99a57-81ee-4232-a105-1fcb4634cef4', '40% PROMOCIONAL', 'DESCONTO_PCT', 40, 0, 0, true, null,        (extract(epoch from now()) * 1000)::bigint),
  ('7a1e0003-0000-4000-8000-000000000050', '5fc99a57-81ee-4232-a105-1fcb4634cef4', '50% MEIA',        'DESCONTO_PCT', 50, 0, 0, true, 'INCLUSIVO', (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do update set value = excluded.value, active = true;
