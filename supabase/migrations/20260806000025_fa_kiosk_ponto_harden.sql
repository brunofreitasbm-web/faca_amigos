-- Fecha o buraco de "bater ponto de qualquer um": até aqui,
-- fa_register_ponto (migration 14) confiava cegamente no p_employee_id e
-- no p_registered_by_employee_id enviados pelo cliente — sem exigir
-- sessão alguma, qualquer chamador podia gravar marcação em nome de
-- qualquer colaborador. A partir de agora a função deriva o colaborador
-- de auth.uid() (fa_kiosk_current_employee_id(), migration 09) e recusa
-- registrar ponto de terceiros — ninguém bate ponto por outra pessoa,
-- nem GERENTE/ADMIN (Portaria MTP 671/2021: a marcação é sempre pessoal).

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
  v_caller_id uuid := fa_kiosk_current_employee_id();
begin
  if v_caller_id is null then
    raise exception 'não autenticado — faça login para bater o ponto';
  end if;
  if p_employee_id <> v_caller_id then
    raise exception 'só é possível registrar o próprio ponto';
  end if;

  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  insert into fa_kiosk_ponto_records (id, employee_id, unit_id, kind, at_ms, registered_by_employee_id)
    values (v_id, v_caller_id, p_unit_id, p_kind, v_now_ms, v_caller_id)
    returning nsr into v_nsr;

  v_cached := jsonb_build_object('id', v_id, 'nsr', v_nsr, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_register_ponto', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

revoke execute on function fa_register_ponto(text, uuid, uuid, text, uuid) from public, anon;
grant execute on function fa_register_ponto(text, uuid, uuid, text, uuid) to authenticated;
