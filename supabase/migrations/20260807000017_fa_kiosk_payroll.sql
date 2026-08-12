-- Folha de Pagamento: extrato mensal (salário-base + dados bancários) para
-- fechamento e futura geração de remessa bancária (Bradesco).
--
-- Salário e dados bancários NÃO entram como colunas de fa_kiosk_employees:
-- essa tabela tem uma policy de leitura aberta a qualquer colaborador
-- autenticado (`fa_kiosk_employees_read`, migration 03/26/28 —
-- `for select to authenticated using (true)`), porque RLS é por linha, não
-- por coluna. Colocar salário/conta bancária ali vazaria o contracheque de
-- todo mundo (inclusive do Owner) para qualquer Operador logado. O mesmo
-- raciocínio já levou o hash de PIN para `fa_kiosk_local_credentials`
-- separada (migration 03, security hardening) — aqui é o mesmo padrão,
-- numa tabela nova com sua própria RLS restrita a `folha_pagamento.*`.

create table if not exists fa_kiosk_employee_payroll_info (
  employee_id uuid primary key references fa_kiosk_employees (id) on delete cascade,
  salary_base_cents int,
  bank_code text,
  bank_agencia text,
  bank_agencia_dv text,
  bank_conta text,
  bank_conta_dv text,
  bank_account_type text check (bank_account_type in ('CORRENTE', 'POUPANCA')),
  pix_key text,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Capacidades novas: salário e conta bancária ficam mais restritos que o
-- cadastro básico do colaborador (`config.employees.write`) — só o Owner.
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'folha_pagamento.read'),
  ('ADMIN', 'folha_pagamento.write')
on conflict do nothing;

alter table fa_kiosk_employee_payroll_info enable row level security;
drop policy if exists fa_kiosk_employee_payroll_info_read on fa_kiosk_employee_payroll_info;
create policy fa_kiosk_employee_payroll_info_read on fa_kiosk_employee_payroll_info
  for select to authenticated using (fa_kiosk_can('folha_pagamento.read'));
drop policy if exists fa_kiosk_employee_payroll_info_write on fa_kiosk_employee_payroll_info;
create policy fa_kiosk_employee_payroll_info_write on fa_kiosk_employee_payroll_info
  for all to authenticated
  using (fa_kiosk_can('folha_pagamento.write'))
  with check (fa_kiosk_can('folha_pagamento.write'));

-- Fechamento de folha: um "run" por unidade/mês, com uma linha por
-- colaborador (`fa_kiosk_payroll_items`) guardando SNAPSHOT dos dados no
-- momento do fechamento (nome, CPF, banco, salário, ajuste, horas) — mesmo
-- princípio de imutabilidade auditável do ponto (fa_kiosk_ponto_records):
-- depois de fechada, a folha não muda se o cadastro do colaborador mudar
-- depois. Sem policy de update/delete de propósito.
create table if not exists fa_kiosk_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  year int not null,
  month int not null check (month between 1 and 12),
  closed_by_employee_id uuid references fa_kiosk_employees (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  total_cents bigint not null default 0,
  unique (unit_id, year, month)
);

create table if not exists fa_kiosk_payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references fa_kiosk_payroll_runs (id) on delete cascade,
  employee_id uuid references fa_kiosk_employees (id),
  full_name_snapshot text not null,
  cpf_snapshot text,
  bank_code_snapshot text,
  bank_agencia_snapshot text,
  bank_agencia_dv_snapshot text,
  bank_conta_snapshot text,
  bank_conta_dv_snapshot text,
  bank_account_type_snapshot text,
  salary_base_cents int not null default 0,
  adjustment_cents int not null default 0,
  adjustment_note text,
  total_cents int not null default 0,
  hours_contracted numeric,
  hours_worked_minutes int
);
create index if not exists idx_fa_kiosk_payroll_items_run on fa_kiosk_payroll_items (payroll_run_id);

alter table fa_kiosk_payroll_runs enable row level security;
drop policy if exists fa_kiosk_payroll_runs_read on fa_kiosk_payroll_runs;
create policy fa_kiosk_payroll_runs_read on fa_kiosk_payroll_runs
  for select to authenticated using (fa_kiosk_can('folha_pagamento.read'));
-- Sem policy de insert/update/delete: só fa_kiosk_close_payroll_run
-- (security definer) grava, e nunca há correção — reabrir é fechar de novo.

alter table fa_kiosk_payroll_items enable row level security;
drop policy if exists fa_kiosk_payroll_items_read on fa_kiosk_payroll_items;
create policy fa_kiosk_payroll_items_read on fa_kiosk_payroll_items
  for select to authenticated using (fa_kiosk_can('folha_pagamento.read'));

-- Fecha a folha do mês atomicamente: cria o run e todos os itens numa
-- transação só. Recebe os itens já revisados pelo Owner na tela (com
-- eventuais ajustes manuais) como jsonb — o servidor não recalcula nada,
-- só audita quem fechou e quando.
create or replace function fa_kiosk_close_payroll_run(
  p_unit_id uuid,
  p_year int,
  p_month int,
  p_items jsonb
) returns uuid as $$
declare
  v_run_id uuid;
  v_total_cents bigint;
  v_item jsonb;
begin
  if not fa_kiosk_can('folha_pagamento.write') then
    raise exception 'sem permissão para fechar folha de pagamento' using errcode = '42501';
  end if;

  select coalesce(sum((elem->>'totalCents')::bigint), 0) into v_total_cents
    from jsonb_array_elements(p_items) elem;

  insert into fa_kiosk_payroll_runs (unit_id, year, month, closed_by_employee_id, total_cents)
  values (p_unit_id, p_year, p_month, fa_kiosk_current_employee_id(), v_total_cents)
  returning id into v_run_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into fa_kiosk_payroll_items (
      payroll_run_id, employee_id, full_name_snapshot, cpf_snapshot,
      bank_code_snapshot, bank_agencia_snapshot, bank_agencia_dv_snapshot,
      bank_conta_snapshot, bank_conta_dv_snapshot, bank_account_type_snapshot,
      salary_base_cents, adjustment_cents, adjustment_note, total_cents,
      hours_contracted, hours_worked_minutes
    ) values (
      v_run_id,
      (v_item->>'employeeId')::uuid,
      v_item->>'fullName',
      v_item->>'cpf',
      v_item->>'bankCode',
      v_item->>'bankAgencia',
      v_item->>'bankAgenciaDv',
      v_item->>'bankConta',
      v_item->>'bankContaDv',
      v_item->>'bankAccountType',
      coalesce((v_item->>'salaryBaseCents')::int, 0),
      coalesce((v_item->>'adjustmentCents')::int, 0),
      v_item->>'adjustmentNote',
      coalesce((v_item->>'totalCents')::int, 0),
      nullif(v_item->>'hoursContracted', '')::numeric,
      nullif(v_item->>'hoursWorkedMinutes', '')::int
    );
  end loop;

  return v_run_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_close_payroll_run(uuid, int, int, jsonb) from public, anon;
grant execute on function fa_kiosk_close_payroll_run(uuid, int, int, jsonb) to authenticated;
