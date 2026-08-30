-- Suporte a correspondência flexível de device_id (prefixo / ID curto como '1a676681')
-- na reserva de trabalhos de impressão (fa_kiosk_claim_print_jobs / fa_kiosk_claim_print_job).

create or replace function fa_kiosk_claim_print_jobs(
  p_device_id text,
  p_unit_ids text[],
  p_limit integer default 10,
  p_grace_ms bigint default 20000,
  p_stale_ms bigint default 180000,
  p_max_attempts integer default 2
) returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_result jsonb;
begin
  if p_device_id is null or btrim(p_device_id) = '' then return '[]'::jsonb; end if;
  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then return '[]'::jsonb; end if;

  update fa_kiosk_print_jobs
     set status = 'PENDING', claimed_by_device_id = null, claimed_at_ms = null
   where status = 'CLAIMED'
     and lower(unit_id::text) = any(p_unit_ids)
     and claimed_at_ms < v_now_ms - p_stale_ms
     and claim_attempts < p_max_attempts;

  update fa_kiosk_print_jobs
     set status = 'FAILED',
         error = 'Impressão não confirmada por nenhum terminal'
   where status = 'CLAIMED'
     and lower(unit_id::text) = any(p_unit_ids)
     and claimed_at_ms < v_now_ms - p_stale_ms
     and claim_attempts >= p_max_attempts;

  with picked as (
    select id from fa_kiosk_print_jobs
     where status = 'PENDING'
       and lower(unit_id::text) = any(p_unit_ids)
       and (origin_device_id is null
            or origin_device_id = p_device_id
            or origin_device_id like p_device_id || '%'
            or p_device_id like origin_device_id || '%'
            or created_at_ms <= v_now_ms - p_grace_ms)
     order by created_at_ms
     limit greatest(p_limit, 1)
     for update skip locked
  ), claimed as (
    update fa_kiosk_print_jobs j
       set status = 'CLAIMED',
           claimed_by_device_id = p_device_id,
           claimed_at_ms = v_now_ms,
           claim_attempts = j.claim_attempts + 1
      from picked
     where j.id = picked.id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'unit_id', c.unit_id,
    'kind', c.kind,
    'payload_json', c.payload_json,
    'origin_device_id', c.origin_device_id)), '[]'::jsonb)
    into v_result
    from claimed c;

  return v_result;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

create or replace function fa_kiosk_claim_print_job(
  p_job_id uuid,
  p_device_id text,
  p_unit_ids text[],
  p_grace_ms bigint default 20000
) returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_result jsonb;
begin
  if p_device_id is null or btrim(p_device_id) = '' then return null; end if;
  if coalesce(array_length(p_unit_ids, 1), 0) = 0 then return null; end if;

  with picked as (
    select id from fa_kiosk_print_jobs
     where id = p_job_id
       and status = 'PENDING'
       and lower(unit_id::text) = any(p_unit_ids)
       and (origin_device_id is null
            or origin_device_id = p_device_id
            or origin_device_id like p_device_id || '%'
            or p_device_id like origin_device_id || '%'
            or created_at_ms <= v_now_ms - p_grace_ms)
     for update skip locked
  ), claimed as (
    update fa_kiosk_print_jobs j
       set status = 'CLAIMED',
           claimed_by_device_id = p_device_id,
           claimed_at_ms = v_now_ms,
           claim_attempts = j.claim_attempts + 1
      from picked
     where j.id = picked.id
    returning j.*
  )
  select jsonb_build_object(
    'id', c.id,
    'unit_id', c.unit_id,
    'kind', c.kind,
    'payload_json', c.payload_json,
    'origin_device_id', c.origin_device_id)
    into v_result
    from claimed c;

  return v_result;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from public;
revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from anon;
revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from authenticated;
grant execute on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) to service_role;

revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from public;
revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from anon;
revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from authenticated;
grant execute on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) to service_role;
