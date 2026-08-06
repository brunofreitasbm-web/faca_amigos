-- Fase 5: ponto via RPC, portando apps/kiosk/src/server/routes/ponto.ts.
-- Sem endpoint de exclusão por desenho (Portaria MTP 671/2021) — e agora
-- reforçado por RLS (migration 09, sem policy de UPDATE/DELETE alguma
-- em fa_kiosk_ponto_records) e pelo NSR vir de uma sequence real do
-- Postgres (migration 06), garantindo sequência sem gaps mesmo com
-- múltiplos dispositivos registrando ponto ao mesmo tempo.

create or replace function fa_register_ponto(
  p_idempotency_key text,
  p_employee_id uuid,
  p_unit_id uuid,
  p_kind text,
  p_registered_by_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_id uuid := gen_random_uuid();
  v_nsr bigint;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  insert into fa_kiosk_ponto_records (id, employee_id, unit_id, kind, at_ms, registered_by_employee_id)
    values (v_id, p_employee_id, p_unit_id, p_kind, v_now_ms, p_registered_by_employee_id)
    returning nsr into v_nsr;

  v_cached := jsonb_build_object('id', v_id, 'nsr', v_nsr, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_register_ponto', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
