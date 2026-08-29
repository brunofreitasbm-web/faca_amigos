-- =====================================================================
-- Tolerância de 1 minuto antes da cobrança do minuto excedente
-- =====================================================================
-- A cobrança do minuto excedente só começa após passar 1 minuto (60.000 ms)
-- do tempo do plano contratado.

create or replace function fa_kiosk_session_timing(
  p_plan record,
  p_checkin_at_ms bigint,
  p_now_ms bigint,
  p_paused_ms_total bigint default 0
) returns jsonb as $$
declare
  elapsed_ms bigint := greatest(0, p_now_ms - p_checkin_at_ms - coalesce(p_paused_ms_total, 0));
  duration_ms bigint := fa_kiosk_plan_duration_minutes(p_plan.duration_value, p_plan.duration_unit) * 60000;
  over_ms bigint := greatest(0, elapsed_ms - duration_ms - 60000);
  over_minutes integer := ceil(over_ms / 60000.0);
  over_cents integer := over_minutes * p_plan.overage_cents_per_minute;
  live_total_cents integer := p_plan.value_cents + over_cents;
  phase text;
begin
  if over_minutes > 0 then phase := 'EXCEDENTE';
  elsif elapsed_ms < duration_ms * 0.8 then phase := 'VERDE';
  else phase := 'AMARELO';
  end if;
  return jsonb_build_object('elapsedMs', elapsed_ms, 'durationMs', duration_ms, 'overMinutes', over_minutes,
    'overCents', over_cents, 'liveTotalCents', live_total_cents, 'phase', phase);
end;
$$ language plpgsql immutable;
