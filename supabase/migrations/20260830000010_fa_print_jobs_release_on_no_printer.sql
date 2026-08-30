-- Quando um terminal reserva um job mas não consegue resolver a impressora
-- localmente (ex.: dois terminais amarrados à mesma unidade, só um com a
-- impressora física instalada), ele hoje finaliza o job na hora (PDF/FAILED)
-- em vez de devolver a reserva para outro terminal daquela unidade tentar.
-- fa_kiosk_release_print_job devolve o job para PENDING mantendo
-- claim_attempts (já incrementado na reserva), para o próximo sweep de
-- QUALQUER terminal amarrado à unidade pegar — inclusive um terminal com a
-- impressora certa configurada.

create or replace function fa_kiosk_release_print_job(
  p_job_id uuid,
  p_device_id text
) returns boolean as $$
declare
  v_updated integer;
begin
  if p_device_id is null or btrim(p_device_id) = '' then return false; end if;

  update fa_kiosk_print_jobs
     set status = 'PENDING', claimed_by_device_id = null, claimed_at_ms = null
   where id = p_job_id
     and status = 'CLAIMED'
     and claimed_by_device_id = p_device_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_release_print_job(uuid, text) from public;
revoke all on function fa_kiosk_release_print_job(uuid, text) from anon;
revoke all on function fa_kiosk_release_print_job(uuid, text) from authenticated;
grant execute on function fa_kiosk_release_print_job(uuid, text) to service_role;

-- O terminal precisa saber quantas vezes o job já foi reservado para
-- decidir entre "devolve pra outro tentar" e "desiste, finaliza aqui"
-- (client-side, contra MAX_CLAIM_ATTEMPTS em printJobPolicy.ts).
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
    'origin_device_id', c.origin_device_id,
    'claim_attempts', c.claim_attempts)), '[]'::jsonb)
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
    'origin_device_id', c.origin_device_id,
    'claim_attempts', c.claim_attempts)
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
