-- =====================================================================
-- Alerta e renovação — Faça Amigos Circuito (carrinhos elétricos e pelúcias)
-- =====================================================================
-- Reaproveita 100% da stack de QR/cronômetro/painel público já construída
-- para o Playground (fa_checkin, fa_acompanhar_por_codigo, AcompanharScreen)
-- — o Circuito já é `activity = 'CARRINHO'` desde 20260806000004. Pelúcia
-- não é uma activity nova: é um "kind" de carrinho (mesma regra de
-- alocação de ativo/plano, valores e cronômetro diferentes), decisão do
-- dono do negócio.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kind do ativo/plano: CARRO x PELUCIA
-- ---------------------------------------------------------------------
alter table fa_kiosk_assets add column if not exists kind text not null default 'CARRO' check (kind in ('CARRO', 'PELUCIA'));
alter table fa_kiosk_plans add column if not exists asset_kind text check (asset_kind in ('CARRO', 'PELUCIA'));

-- ---------------------------------------------------------------------
-- 2. Planos do Circuito (Tabela 1 / Tabela 2 x Carro / Pelúcia)
-- ---------------------------------------------------------------------
-- Um conjunto por unidade QUIOSQUE existente. overage_cents_per_minute
-- reaproveita a mesma âncora de R$ 3,00/min usada no Playground — regra
-- explícita do prompt de negócio ("minuto excedente custa R$ 3,00/min").
do $$
declare
  v_unit record;
begin
  for v_unit in select id from fa_kiosk_units where kind = 'QUIOSQUE' loop
    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, asset_kind, color)
    select v_unit.id, 'CARRINHO', 'Tabela 1 - Carro (15 min)', 2500, 15, 'MINUTO', 300, 'CARRO', '#2ECFB5'
    where not exists (select 1 from fa_kiosk_plans where unit_id = v_unit.id and name = 'Tabela 1 - Carro (15 min)');

    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, asset_kind, color)
    select v_unit.id, 'CARRINHO', 'Tabela 1 - Pelúcia (10 min)', 2500, 10, 'MINUTO', 300, 'PELUCIA', '#2ECFB5'
    where not exists (select 1 from fa_kiosk_plans where unit_id = v_unit.id and name = 'Tabela 1 - Pelúcia (10 min)');

    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, asset_kind, color)
    select v_unit.id, 'CARRINHO', 'Tabela 2 - Carro (30 min)', 4800, 30, 'MINUTO', 300, 'CARRO', '#2ECFB5'
    where not exists (select 1 from fa_kiosk_plans where unit_id = v_unit.id and name = 'Tabela 2 - Carro (30 min)');

    insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, asset_kind, color)
    select v_unit.id, 'CARRINHO', 'Tabela 2 - Pelúcia (20 min)', 4800, 20, 'MINUTO', 300, 'PELUCIA', '#2ECFB5'
    where not exists (select 1 from fa_kiosk_plans where unit_id = v_unit.id and name = 'Tabela 2 - Pelúcia (20 min)');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. fa_acompanhar_por_codigo passa a devolver activity + assetKind
-- ---------------------------------------------------------------------
-- Necessário para o painel do responsável decidir entre a régua de
-- alerta do Playground (fase VERMELHO/EXCEDENTE) e a régua específica do
-- Circuito por tabela (ver copyCircuito.ts no client).
create or replace function fa_acompanhar_por_codigo(p_code text) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code;
  if not found then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  if v_s.status = 'FINALIZADA' then
    return jsonb_build_object(
      'status', 'FINALIZADA',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
      'checkoutAtMs', v_s.checkout_at_ms
    );
  end if;

  if v_s.uses_hour_bank then
    return jsonb_build_object(
      'status', 'NAO_SUPORTADO',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1)
    );
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;

  return jsonb_build_object(
    'status', case when v_s.paused_at_ms is not null then 'PAUSADA' else 'ATIVA' end,
    'sessionId', v_s.id,
    'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
    'activity', v_s.activity,
    'checkinAtMs', v_s.checkin_at_ms,
    'pausedAtMs', v_s.paused_at_ms,
    'pausedMsTotal', coalesce(v_s.paused_ms_total, 0),
    'sensoryTags', to_jsonb(coalesce(v_s.sensory_tags, array[]::text[])),
    'plan', jsonb_build_object(
      'durationValue', v_plan.duration_value,
      'durationUnit', v_plan.duration_unit,
      'valueCents', v_plan.value_cents,
      'overageCentsPerMinute', v_plan.overage_cents_per_minute,
      'assetKind', v_plan.asset_kind
    )
  );
end;
$$ language plpgsql stable security definer;
