-- Foto da marcação: o quiosque tira uma foto no momento do ponto (depois de
-- já ter comparado o rosto no cliente contra o descriptor cadastrado — ver
-- migration anterior) e o servidor só grava o caminho no Storage como
-- evidência, junto do NSR. Coluna aditiva, não mexe na garantia insert-only
-- de fa_kiosk_ponto_records nem nas colunas existentes.
alter table fa_kiosk_ponto_records add column if not exists punch_photo_path text;

-- Mesmo motivo do DROP na migration de geofence: mudar a assinatura de
-- fa_register_ponto (7 parâmetros → 8) sem apagar a versão anterior deixaria
-- as duas coexistindo no banco.
drop function if exists fa_register_ponto(text, uuid, uuid, text, uuid, numeric, numeric);

create or replace function fa_register_ponto(
  p_idempotency_key text,
  p_employee_id uuid,
  p_unit_id uuid,
  p_kind text,
  p_registered_by_employee_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_punch_photo_path text default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_id uuid := gen_random_uuid();
  v_nsr bigint;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_caller_id uuid := fa_kiosk_current_employee_id();
  v_unit_lat numeric;
  v_unit_lng numeric;
  v_unit_radius integer;
  v_distance_m numeric;
begin
  if v_caller_id is null then
    raise exception 'não autenticado — faça login para bater o ponto';
  end if;
  if p_employee_id <> v_caller_id then
    raise exception 'só é possível registrar o próprio ponto';
  end if;

  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select latitude, longitude, geofence_radius_m into v_unit_lat, v_unit_lng, v_unit_radius
    from fa_kiosk_units where id = p_unit_id;

  if v_unit_lat is not null and v_unit_lng is not null and v_unit_radius is not null then
    if p_lat is null or p_lng is null then
      raise exception 'localização não enviada — esta unidade exige GPS para bater ponto' using errcode = '22023';
    end if;
    v_distance_m := fa_kiosk_haversine_m(p_lat, p_lng, v_unit_lat, v_unit_lng);
    if v_distance_m > v_unit_radius then
      raise exception 'fora da área da unidade (a %m do local configurado, limite %m) — aproxime-se para bater o ponto',
        round(v_distance_m), v_unit_radius using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from fa_kiosk_ponto_records
     where employee_id = v_caller_id
       and kind = p_kind
       and at_ms > v_now_ms - 5000
  ) then
    raise exception 'marcação repetida em menos de 5 segundos — aguarde antes de tentar de novo' using errcode = '23514';
  end if;

  insert into fa_kiosk_ponto_records (id, employee_id, unit_id, kind, at_ms, registered_by_employee_id, punch_photo_path)
    values (v_id, v_caller_id, p_unit_id, p_kind, v_now_ms, v_caller_id, p_punch_photo_path)
    returning nsr into v_nsr;

  v_cached := jsonb_build_object('id', v_id, 'nsr', v_nsr, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_register_ponto', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_register_ponto(text, uuid, uuid, text, uuid, numeric, numeric, text) from public, anon;
grant execute on function fa_register_ponto(text, uuid, uuid, text, uuid, numeric, numeric, text) to authenticated;
