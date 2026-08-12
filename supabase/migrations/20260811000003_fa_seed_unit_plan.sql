-- Seed de Unidade e Plano Padrão para o Faça Amigos Playground (Parque Shopping)
insert into fa_kiosk_units (id, kind, name, timezone, business_day_cutoff_hour)
values ('11111111-1111-1111-1111-111111111111', 'LOJA', 'Faça Amigos Playground (Parque Shopping)', 'America/Belem', 4)
on conflict (id) do update set name = 'Faça Amigos Playground (Parque Shopping)';

insert into fa_kiosk_plans (id, unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'PLAYGROUND', 'Sessão Playground (Legado)', 10000, 30, 'MINUTO', 100, '#2ECFB5', true)
on conflict (id) do nothing;
