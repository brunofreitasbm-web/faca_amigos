-- Impressão duplicada entre unidades: o app instalado em dois
-- computadores, um por unidade, imprimia o job da outra unidade também.
--
-- A raiz estava no terminal (a amarração terminal->unidade nunca era
-- gravada, então o filtro do bridge era fail-open), mas o roteamento em
-- si nunca teve trava: handleJob imprimia e SÓ DEPOIS marcava PRINTED.
-- Dois bridges ligados imprimem duas vezes — exatamente o que
-- 20260806000032_fa_kiosk_fiscal_docs.sql já anotava como pendência.
--
-- Aqui entra a reserva atômica, no mesmo formato de fa_fiscal_claim_next
-- (20260806000033): `for update skip locked` faz dois terminais
-- concorrentes nunca enxergarem a mesma linha. É a única garantia de
-- impressão única, independente de quantos terminais escutem a tabela.

-- A migration 20260819000006 (fallback de cupom em PDF) NUNCA foi aplicada
-- em produção: fa_kiosk_print_jobs não tem pdf_path/pdf_url e o CHECK de
-- status não aceita SAVED_PDF, então handleReceiptPdfFallback falha em toda
-- invocação. Como o fluxo novo depende desses UPDATEs darem certo, as
-- colunas entram aqui também — idempotente, no-op onde já existirem.
alter table fa_kiosk_print_jobs add column if not exists pdf_path text;
alter table fa_kiosk_print_jobs add column if not exists pdf_url text;

alter table fa_kiosk_print_jobs add column if not exists claimed_by_device_id text;
alter table fa_kiosk_print_jobs add column if not exists claimed_at_ms bigint;
alter table fa_kiosk_print_jobs add column if not exists claim_attempts integer not null default 0;

alter table fa_kiosk_print_jobs drop constraint if exists fa_kiosk_print_jobs_status_check;
alter table fa_kiosk_print_jobs add constraint fa_kiosk_print_jobs_status_check
  check (status in ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED', 'SAVED_PDF'));

create index if not exists idx_fa_kiosk_print_jobs_claim
  on fa_kiosk_print_jobs (status, unit_id, created_at_ms);

-- Descarta a fila acumulada ANTES deste ajuste. Sem isto, o primeiro
-- sweep do terminal corrigido despeja de uma vez todo o PENDING antigo —
-- um rolo inteiro de pulseiras saindo no balcão. Constante fixa (e não
-- now()) para a linha ser idempotente e segura de reexecutar via
-- apply_all.sql.
update fa_kiosk_print_jobs
   set status = 'FAILED',
       error = 'Fila anterior ao ajuste de roteamento por unidade'
 where status = 'PENDING'
   and created_at_ms < 1788048000000;

-- ---------------------------------------------------------------------
-- Reserva em lote (o sweep periódico do bridge)
-- ---------------------------------------------------------------------
-- p_grace_ms: janela em que só o terminal que ORIGINOU o pedido pode
-- reservar. Passada a janela, qualquer terminal amarrado àquela unidade
-- assume. É preferência, não exclusividade, de propósito: venda feita em
-- tablet/PWA chega com origin_device_id nulo, e regra estrita deixaria
-- esse cupom sem imprimir em lugar nenhum, em silêncio.
--
-- p_stale_ms: devolve para a fila o job reservado por um terminal que
-- caiu no meio da impressão. p_max_attempts limita a uma segunda via, no
-- máximo — nunca um loop de reimpressão.
--
-- Não conflita com fa_kiosk_cleanup_expired_pdf_receipts (20260819000006):
-- aquela função só apaga SAVED_PDF e nunca toca PENDING/CLAIMED. Se um
-- dia alguém for "melhorar" o predicado dela, este comentário é o aviso.
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
  -- Fail-closed também no banco: terminal sem identidade ou sem unidade
  -- amarrada não reserva nada.
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

-- ---------------------------------------------------------------------
-- Reserva de um job só (o caminho do evento Realtime)
-- ---------------------------------------------------------------------
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

-- O EXECUTE padrão do Postgres é PUBLIC; estas funções mexem na fila de
-- impressão de todas as unidades e só o print bridge (service_role) deve
-- chamá-las.
revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from public;
revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from anon;
revoke all on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) from authenticated;
grant execute on function fa_kiosk_claim_print_jobs(text, text[], integer, bigint, bigint, integer) to service_role;

revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from public;
revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from anon;
revoke all on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) from authenticated;
grant execute on function fa_kiosk_claim_print_job(uuid, text, text[], bigint) to service_role;

-- ---------------------------------------------------------------------
-- Reimpressão de entrada carregando o terminal de origem
-- ---------------------------------------------------------------------
-- fa_reimprimir_entrada chamava fa_kiosk_enqueue_entry_prints sem device,
-- então a reimpressão entrava na fila sem origem. Com o claim isso não
-- duplica mais, mas sem a origem a preferência pelo terminal que pediu a
-- reimpressão não funciona. Recriada também para ganhar o
-- `set search_path` que faltava na definição de 20260807000007.
-- A assinatura de 2 argumentos precisa sair: ela chama a versão de 1
-- argumento de fa_kiosk_enqueue_entry_prints, que não carimba a origem, e
-- um chamador com 2 argumentos casaria nela por arity exata em vez de cair
-- na versão nova com default.
drop function if exists fa_reimprimir_entrada(uuid, uuid);

create or replace function fa_reimprimir_entrada(
  p_session_id uuid,
  p_employee_id uuid default null,
  p_device_id text default null
) returns jsonb as $$
declare v_s record;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then raise exception 'SESSAO_NAO_ENCONTRADA'; end if;
  if v_s.access_code is null then
    update fa_kiosk_sessions set access_code = fa_kiosk_new_access_code() where id = p_session_id;
    select * into v_s from fa_kiosk_sessions where id = p_session_id;
  end if;
  perform fa_kiosk_enqueue_entry_prints(p_session_id, p_device_id);
  perform fa_kiosk_log_session_event(p_session_id, 'REIMPRESSAO_ENTRADA', p_employee_id, null);
  return jsonb_build_object('accessCode', v_s.access_code);
end;
$$ language plpgsql volatile security definer set search_path = public, extensions, pg_temp;
