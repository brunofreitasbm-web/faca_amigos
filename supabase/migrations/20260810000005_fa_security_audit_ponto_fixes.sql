-- QA hostil no Espelho de Ponto (2026-08-10) encontrou 2 buracos reais de
-- RBAC, confirmados contra o schema live (não só os arquivos locais — este
-- projeto tem drift conhecido, ver fa_kiosk_employees.unit_id que só existe
-- via migration remota "add_employee_details_and_coupon_partner", nunca
-- versionada aqui):
--
-- 1) fa_kiosk_ponto_records tinha policy de SELECT `using (true)` para
--    QUALQUER `authenticated` — um OPERADOR sem `relatorio.ponto` lia, via
--    PostgREST direto (bypassando a RPC/UI), as marcações de ponto de
--    qualquer colega, inclusive do Owner. O gate de capacidade só existia
--    na RPC fa_kiosk_espelho_ponto, nunca na tabela.
--
-- 2) fa_kiosk_espelho_ponto não verificava se o colaborador-alvo pertence à
--    mesma unidade de quem chama — um GERENTE (Líder) com `relatorio.ponto`
--    conseguia gerar o espelho, com CPF/RG/CTPS/data de nascimento, de
--    colaborador de OUTRA unidade. Hoje inofensivo (os 3 colaboradores
--    cadastrados são todos ADMIN, sem GERENTE ativo), mas vira exploração
--    real assim que houver um Líder por unidade.

-- ---------------------------------------------------------------------------
-- 1. RLS: só o próprio colaborador, ou quem tem `relatorio.ponto` /
--    `folha_pagamento.read`, lê fa_kiosk_ponto_records.
-- ---------------------------------------------------------------------------
-- Os 3 pontos de leitura direta do app continuam funcionando:
--   - Api.pontoHistory(authedAs.id, ...) — sempre o próprio id (PontoScreen).
--   - Api.reportPonto(...) — Relatório > Folha de Ponto, atrás de
--     `relatorio.read`; hoje quem tem `relatorio.read` (GERENTE+) também tem
--     `relatorio.ponto` (mesmo rank na migration de capacidades), então
--     nada quebra.
--   - Api.getFolhaPagamentoData(...) — Gerencial > Folha de Pagamento, só
--     ADMIN (`folha_pagamento.read`).
drop policy if exists fa_kiosk_read_authenticated on fa_kiosk_ponto_records;
create policy fa_kiosk_ponto_records_read on fa_kiosk_ponto_records
  for select to authenticated
  using (
    employee_id = fa_kiosk_current_employee_id()
    or fa_kiosk_can('relatorio.ponto')
    or fa_kiosk_can('folha_pagamento.read')
  );

-- ---------------------------------------------------------------------------
-- 2. fa_kiosk_espelho_ponto: escopo de unidade para quem não é ADMIN.
-- ---------------------------------------------------------------------------
-- Owner (ADMIN) continua cross-unit por desenho (é o próprio propósito do
-- Modo Gerencial). GERENTE só gera espelho de colaborador que atue em pelo
-- menos uma unidade em comum (fa_kiosk_employee_units).
create or replace function fa_kiosk_espelho_ponto(p_employee_id uuid, p_year int, p_month int)
returns jsonb as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_employee jsonb;
  v_records jsonb;
  v_units jsonb;
  v_caller_id uuid := fa_kiosk_current_employee_id();
  v_caller_role text;
begin
  if not fa_kiosk_can('relatorio.ponto') then
    raise exception 'sem permissão para gerar espelho de ponto' using errcode = '42501';
  end if;
  if p_month < 1 or p_month > 12 then
    raise exception 'mês inválido' using errcode = '22023';
  end if;

  select coalesce(u.timezone, 'America/Belem') into v_tz
    from fa_kiosk_employees e
    left join fa_kiosk_units u on u.id = e.unit_id
   where e.id = p_employee_id;

  if not found then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  select role into v_caller_role from fa_kiosk_employees where id = v_caller_id;

  if v_caller_role <> 'ADMIN' and p_employee_id <> v_caller_id and not exists (
    select 1
      from fa_kiosk_employee_units caller_u
      join fa_kiosk_employee_units target_u on target_u.unit_id = caller_u.unit_id
     where caller_u.employee_id = v_caller_id
       and target_u.employee_id = p_employee_id
  ) then
    raise exception 'colaborador fora do escopo da sua unidade' using errcode = '42501';
  end if;

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, v_tz);
  v_to := v_from + interval '1 month';

  select to_jsonb(row) into v_employee
    from (
      select
        e.id, e.full_name, e.cpf, e.position, e.role, e.admission_date,
        e.weekly_hours_contracted, e.birth_date,
        pi.rg_numero, pi.rg_orgao_emissor,
        pi.ctps_numero, pi.ctps_serie, pi.ctps_uf
        from fa_kiosk_employees e
        left join fa_kiosk_employee_personal_info pi on pi.employee_id = e.id
       where e.id = p_employee_id
    ) row;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', u.name,
           'razaoSocial', u.razao_social,
           'nomeFantasia', u.nome_fantasia,
           'cnpj', u.cnpj,
           'address', u.address,
           'phone', coalesce(u.phone, u.fone)
         ) order by u.name), '[]'::jsonb)
    into v_units
    from fa_kiosk_employee_units eu
    join fa_kiosk_units u on u.id = eu.unit_id
   where eu.employee_id = p_employee_id;

  select coalesce(jsonb_agg(jsonb_build_object('atMs', at_ms, 'kind', kind, 'nsr', nsr) order by at_ms), '[]'::jsonb)
    into v_records
    from fa_kiosk_ponto_records
   where employee_id = p_employee_id
     and to_timestamp(at_ms / 1000.0) >= v_from
     and to_timestamp(at_ms / 1000.0) < v_to;

  return jsonb_build_object(
    'employee', v_employee,
    'units', v_units,
    'records', v_records,
    'year', p_year,
    'month', p_month,
    'timezone', v_tz
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_espelho_ponto(uuid, int, int) from public, anon;
grant execute on function fa_kiosk_espelho_ponto(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. fa_register_ponto: trava marcação repetida do mesmo tipo em <5s.
-- ---------------------------------------------------------------------------
-- Duplo clique (ou double-tap num terminal touch) não é pego pela
-- idempotência existente: cada clique gera uma idempotency_key NOVA
-- (crypto.randomUUID() no cliente), então o cache de idempotência só
-- protege reenvio de uma MESMA chamada em retry de rede, não 2 cliques
-- reais. Front-end ganhou uma guarda (if (busy) return;), mas a garantia
-- de verdade tem que estar aqui: 2 marcações do mesmo tipo, para o mesmo
-- colaborador, em menos de 5s, é sempre erro operacional — nenhuma jornada
-- real bate ENTRADA duas vezes em 5 segundos.
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

revoke execute on function fa_register_ponto(text, uuid, uuid, text, uuid) from public, anon;
grant execute on function fa_register_ponto(text, uuid, uuid, text, uuid) to authenticated;
