-- fa_register_ponto passa a aceitar (e, quando a unidade tem geofence
-- configurado — migration anterior) EXIGIR a localização de quem está
-- batendo o ponto. A validação real é sempre no servidor: GPS enviado pelo
-- cliente sem checagem aqui seria só decoração, trivialmente forjável, e
-- este é um registro de jornada com valor legal (Portaria MTP 671/2021).
--
-- Assinatura muda (5 parâmetros → 7), e Postgres trata isso como uma função
-- NOVA, não uma substituição — sem o DROP explícito abaixo, a versão de
-- 5 parâmetros ficaria esquecida no banco e o PostgREST passaria a ter duas
-- funções `fa_register_ponto` candidatas para o mesmo nome.
drop function if exists fa_register_ponto(text, uuid, uuid, text, uuid);

create or replace function fa_kiosk_haversine_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric) returns numeric as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$ language sql immutable set search_path = public, pg_temp;

create or replace function fa_register_ponto(
  p_idempotency_key text,
  p_employee_id uuid,
  p_unit_id uuid,
  p_kind text,
  p_registered_by_employee_id uuid,
  p_lat numeric default null,
  p_lng numeric default null
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

  insert into fa_kiosk_ponto_records (id, employee_id, unit_id, kind, at_ms, registered_by_employee_id)
    values (v_id, v_caller_id, p_unit_id, p_kind, v_now_ms, v_caller_id)
    returning nsr into v_nsr;

  v_cached := jsonb_build_object('id', v_id, 'nsr', v_nsr, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_register_ponto', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_register_ponto(text, uuid, uuid, text, uuid, numeric, numeric) from public, anon;
grant execute on function fa_register_ponto(text, uuid, uuid, text, uuid, numeric, numeric) to authenticated;
