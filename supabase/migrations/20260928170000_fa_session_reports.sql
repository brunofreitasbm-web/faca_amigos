-- Relatório de Sessão: mapa de observação por setor (Educação Física,
-- Psicologia, Terapia Ocupacional, Pedagogia) preenchido por qualquer
-- profissional/estagiário em até 40 min após o checkout de sessões com plano
-- >= 60 min, salvo com rastreabilidade e enviado ao responsável por WhatsApp
-- (texto redigido por IA na Edge Function session-report-dispatch).
--
-- Escrita SÓ por RPC security definer (sem policy de INSERT). Envio ao
-- WhatsApp respeita o aceite do responsável (fa_kiosk_guardians.
-- whatsapp_consent_at_ms, migration 20260928150000): sem aceite, o relatório
-- é salvo e o envio fica SKIPPED_NO_CONSENT.

-- ---------------------------------------------------------------------
-- 1. Setor do colaborador
-- ---------------------------------------------------------------------
alter table fa_kiosk_employees add column if not exists sector text;
alter table fa_kiosk_employees drop constraint if exists fa_kiosk_employees_sector_check;
alter table fa_kiosk_employees add constraint fa_kiosk_employees_sector_check
  check (sector is null or sector in ('EDUCACAO_FISICA', 'PSICOLOGIA', 'TERAPIA_OCUPACIONAL', 'PEDAGOGIA'));

create or replace function fa_config_set_employee_sector(p_employee_id uuid, p_sector text) returns void as $$
declare
  v_old text;
begin
  if not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para alterar o setor de colaborador' using errcode = '42501';
  end if;
  if p_sector is not null and p_sector not in ('EDUCACAO_FISICA', 'PSICOLOGIA', 'TERAPIA_OCUPACIONAL', 'PEDAGOGIA') then
    raise exception 'setor inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from fa_kiosk_employees where id = p_employee_id) then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;
  select sector into v_old from fa_kiosk_employees where id = p_employee_id;
  update fa_kiosk_employees set sector = p_sector where id = p_employee_id;
  perform fa_config_audit('CONFIG_EMPLOYEE_SECTOR_CHANGE',
                          jsonb_build_object('employeeId', p_employee_id, 'from', v_old, 'to', p_sector));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_set_employee_sector(uuid, text) from public, anon;
grant execute on function fa_config_set_employee_sector(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Capacidades
--    ESTAGIARIO tem rank 0 no fa_kiosk_can: uma linha nele vale para todos
--    os papéis. PRESTADOR_PJ fica explícito só para deixar a intenção clara.
-- ---------------------------------------------------------------------
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ESTAGIARIO',   'relatorio_sessao.write'),
  ('PRESTADOR_PJ', 'relatorio_sessao.write'),
  ('GERENTE',      'relatorio_sessao.read')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Template do CRM para o relatório (fora da janela de 24h só template vale)
-- ---------------------------------------------------------------------
-- ATENÇÃO: cada migration que acrescenta uma finalidade REDEFINE esta constraint.
-- Esta roda depois de 20260928160000_fa_crm_renewal_alert.sql (que trouxe
-- 'RENOVACAO'), então lista todos os valores. Se outra migration futura mexer
-- aqui, ela tem que repetir a lista completa.
alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in ('GERAL', 'NPS', 'RENOVACAO', 'RELATORIO_SESSAO'));

-- ---------------------------------------------------------------------
-- 4. Tabela: 1 relatório por sessão
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_session_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references fa_kiosk_sessions (id),
  unit_id uuid not null references fa_kiosk_units (id),
  child_id uuid not null references fa_kiosk_children (id),
  child_name_snapshot text not null,
  guardian_id uuid references fa_kiosk_guardians (id),
  -- Quem preencheu e em que condição (rastreabilidade)
  filled_by_employee_id uuid not null references fa_kiosk_employees (id),
  filled_by_sector_snapshot text,
  device_id text,
  -- Conteúdo
  catalog_version integer not null,
  answers jsonb not null default '{}'::jsonb,   -- { item_key: 'APOIO'|'DESENVOLVENDO'|'AUTONOMO' }
  observacao text,
  -- Contexto da sessão no momento do preenchimento
  session_checkin_at_ms bigint not null,
  session_checkout_at_ms bigint not null,
  eligible_minutes integer not null,
  filled_at_ms bigint not null,
  late boolean not null,                         -- preenchido > 40 min após o checkout (calculado no servidor)
  -- Envio ao responsável
  whatsapp_status text not null default 'PENDING'
    check (whatsapp_status in ('PENDING', 'SENT', 'SKIPPED_NO_CONSENT', 'SKIPPED_OPT_OUT', 'SKIPPED_NO_PHONE',
                               'SKIPPED_NO_CHANNEL', 'SKIPPED_NO_TEMPLATE', 'FAILED')),
  whatsapp_error text,
  send_mode text check (send_mode in ('TEMPLATE', 'FREEFORM')),
  crm_contact_id uuid references fa_crm_contacts (id),
  crm_message_id uuid references fa_crm_messages (id) on delete set null,
  ai_message text,
  ai_model text,
  ai_fallback boolean not null default false,    -- true se o texto veio do modelo determinístico
  sent_at_ms bigint,
  dispatch_attempts integer not null default 0,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_fa_session_reports_unit on fa_kiosk_session_reports (unit_id, filled_at_ms desc);
create index if not exists idx_fa_session_reports_child on fa_kiosk_session_reports (child_id, filled_at_ms desc);
create index if not exists idx_fa_session_reports_dispatch on fa_kiosk_session_reports (whatsapp_status)
  where whatsapp_status in ('PENDING', 'FAILED');

-- Análise por item sem custo de escrita. security_invoker: respeita a RLS de quem consulta.
create or replace view fa_kiosk_session_report_items_v with (security_invoker = true) as
  select r.id as report_id, r.unit_id, r.child_id, r.filled_at_ms, r.catalog_version,
         i.key as item_key, i.value as level
  from fa_kiosk_session_reports r, jsonb_each_text(r.answers) i;

-- ---------------------------------------------------------------------
-- 5. RLS: lê quem tem .read, ou quem preencheu. Sem INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------
alter table fa_kiosk_session_reports enable row level security;

drop policy if exists fa_session_reports_read on fa_kiosk_session_reports;
create policy fa_session_reports_read on fa_kiosk_session_reports
  for select to authenticated
  using (fa_kiosk_can('relatorio_sessao.read') or filled_by_employee_id = fa_kiosk_current_employee_id());

-- ---------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------

-- Fila de pendentes. NÃO devolve telefone (o estagiário não precisa dele).
create or replace function fa_session_reports_pending(p_unit_id uuid)
returns table (
  session_id uuid, child_id uuid, child_name text, guardian_name text, guardian_phone_present boolean,
  checkin_at_ms bigint, checkout_at_ms bigint, eligible_minutes integer, plan_name text, deadline_ms bigint
) as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not fa_kiosk_can('relatorio_sessao.write') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select s.id, s.child_id, s.child_name_snapshot, g.full_name,
           (g.phone_e164 is not null and g.phone_e164 <> ''),
           s.checkin_at_ms, s.checkout_at_ms, m.minutes, p.name, s.checkout_at_ms + 2400000
    from fa_kiosk_sessions s
    left join fa_kiosk_plans p on p.id = s.plan_id
    left join fa_kiosk_guardians g on g.id = s.guardian_id
    cross join lateral (
      select greatest(
        coalesce(fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit), 0),
        coalesce(s.hour_bank_allocated_minutes, 0),
        coalesce(s.package_allocated_minutes, 0),
        coalesce(s.child_credit_allocated_minutes, 0)
      ) as minutes
    ) m
    where s.unit_id = p_unit_id
      and s.status = 'FINALIZADA'
      and s.checkout_at_ms is not null
      and s.checkout_at_ms >= v_now_ms - 12 * 3600 * 1000
      and s.child_id is not null
      and m.minutes >= 60
      and not exists (select 1 from fa_kiosk_session_reports r where r.session_id = s.id)
    order by s.checkout_at_ms asc;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_session_reports_pending(uuid) from public, anon;
grant execute on function fa_session_reports_pending(uuid) to authenticated;

-- "Enviados hoje": só os do próprio colaborador, exceto quem tem .read (vê a unidade).
create or replace function fa_session_reports_recent(p_unit_id uuid, p_since_ms bigint)
returns table (
  id uuid, session_id uuid, child_name_snapshot text, filled_at_ms bigint, late boolean,
  whatsapp_status text, whatsapp_error text, ai_message text, filled_by_name text
) as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_all boolean := fa_kiosk_can('relatorio_sessao.read');
begin
  if not fa_kiosk_can('relatorio_sessao.write') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select r.id, r.session_id, r.child_name_snapshot, r.filled_at_ms, r.late,
           r.whatsapp_status, r.whatsapp_error, r.ai_message, e.full_name
    from fa_kiosk_session_reports r
    join fa_kiosk_employees e on e.id = r.filled_by_employee_id
    where r.unit_id = p_unit_id
      and r.filled_at_ms >= p_since_ms
      and (v_all or r.filled_by_employee_id = v_emp)
    order by r.filled_at_ms desc
    limit 200;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_session_reports_recent(uuid, bigint) from public, anon;
grant execute on function fa_session_reports_recent(uuid, bigint) to authenticated;

-- Grava o relatório. Idempotente: 1 por sessão; replay da fila offline devolve o existente.
-- p_idempotency_key é injetado por callResilient (offlineQueue.ts) e aqui é só aceito:
-- a unicidade por sessão já garante a idempotência.
create or replace function fa_session_report_submit(
  p_session_id uuid,
  p_catalog_version integer,
  p_answers jsonb,
  p_observacao text default null,
  p_device_id text default null,
  p_idempotency_key text default null
) returns jsonb as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_sector text;
  v_s fa_kiosk_sessions%rowtype;
  v_existing fa_kiosk_session_reports%rowtype;
  v_minutes integer;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_late boolean;
  v_id uuid;
  v_bad integer;
  v_answered integer;
begin
  if not fa_kiosk_can('relatorio_sessao.write') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'colaborador não identificado' using errcode = '42501';
  end if;

  select * into v_existing from fa_kiosk_session_reports where session_id = p_session_id;
  if found then
    return jsonb_build_object('id', v_existing.id, 'late', v_existing.late, 'already_existed', true,
                              'whatsapp_status', v_existing.whatsapp_status);
  end if;

  select * into v_s from fa_kiosk_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSAO_NAO_ENCONTRADA'; end if;
  if v_s.status <> 'FINALIZADA' or v_s.checkout_at_ms is null then raise exception 'SESSAO_NAO_FINALIZADA'; end if;
  if v_s.child_id is null then raise exception 'SESSAO_SEM_CRIANCA'; end if;

  select greatest(
    coalesce((select fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) from fa_kiosk_plans p where p.id = v_s.plan_id), 0),
    coalesce(v_s.hour_bank_allocated_minutes, 0),
    coalesce(v_s.package_allocated_minutes, 0),
    coalesce(v_s.child_credit_allocated_minutes, 0)
  ) into v_minutes;
  if v_minutes < 60 then raise exception 'SESSAO_NAO_ELEGIVEL'; end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'respostas inválidas' using errcode = '22023';
  end if;
  select count(*) into v_bad from jsonb_each_text(p_answers) a where a.value not in ('APOIO', 'DESENVOLVENDO', 'AUTONOMO');
  if v_bad > 0 then raise exception 'nível de resposta inválido' using errcode = '22023'; end if;
  select count(*) into v_answered from jsonb_object_keys(p_answers);

  v_late := v_now > v_s.checkout_at_ms + 2400000;
  select sector into v_sector from fa_kiosk_employees where id = v_emp;

  insert into fa_kiosk_session_reports (
    session_id, unit_id, child_id, child_name_snapshot, guardian_id,
    filled_by_employee_id, filled_by_sector_snapshot, device_id,
    catalog_version, answers, observacao,
    session_checkin_at_ms, session_checkout_at_ms, eligible_minutes, filled_at_ms, late
  ) values (
    v_s.id, v_s.unit_id, v_s.child_id, coalesce(v_s.child_name_snapshot, ''), v_s.guardian_id,
    v_emp, v_sector, nullif(btrim(coalesce(p_device_id, '')), ''),
    p_catalog_version, p_answers, nullif(left(btrim(coalesce(p_observacao, '')), 300), ''),
    v_s.checkin_at_ms, v_s.checkout_at_ms, v_minutes, v_now, v_late
  )
  on conflict (session_id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from fa_kiosk_session_reports where session_id = p_session_id;
    return jsonb_build_object('id', v_existing.id, 'late', v_existing.late, 'already_existed', true,
                              'whatsapp_status', v_existing.whatsapp_status);
  end if;

  perform fa_kiosk_log_session_event(p_session_id, 'RELATORIO_SESSAO', v_emp,
    jsonb_build_object('reportId', v_id, 'late', v_late, 'catalogVersion', p_catalog_version,
                       'answeredCount', v_answered, 'sector', v_sector));

  return jsonb_build_object('id', v_id, 'late', v_late, 'already_existed', false, 'whatsapp_status', 'PENDING');
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_submit(uuid, integer, jsonb, text, text, text) from public, anon;
grant execute on function fa_session_report_submit(uuid, integer, jsonb, text, text, text) to authenticated;

-- Resultado do envio. Só a Edge Function (service role) chama.
create or replace function fa_session_report_mark_dispatch(
  p_report_id uuid,
  p_status text,
  p_error text,
  p_send_mode text,
  p_crm_contact_id uuid,
  p_crm_message_id uuid,
  p_ai_message text,
  p_ai_model text,
  p_ai_fallback boolean
) returns void as $$
begin
  if p_status not in ('PENDING', 'SENT', 'SKIPPED_NO_CONSENT', 'SKIPPED_OPT_OUT', 'SKIPPED_NO_PHONE',
                      'SKIPPED_NO_CHANNEL', 'SKIPPED_NO_TEMPLATE', 'FAILED') then
    raise exception 'status inválido' using errcode = '22023';
  end if;
  update fa_kiosk_session_reports set
    whatsapp_status = p_status,
    whatsapp_error = p_error,
    send_mode = coalesce(p_send_mode, send_mode),
    crm_contact_id = coalesce(p_crm_contact_id, crm_contact_id),
    crm_message_id = coalesce(p_crm_message_id, crm_message_id),
    ai_message = coalesce(p_ai_message, ai_message),
    ai_model = coalesce(p_ai_model, ai_model),
    ai_fallback = coalesce(p_ai_fallback, ai_fallback),
    sent_at_ms = case when p_status = 'SENT' then (extract(epoch from now()) * 1000)::bigint else sent_at_ms end,
    dispatch_attempts = dispatch_attempts + 1
  where id = p_report_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_mark_dispatch(uuid, text, text, text, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
