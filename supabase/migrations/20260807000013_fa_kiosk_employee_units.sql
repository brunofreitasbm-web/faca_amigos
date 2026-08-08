-- Atribuição de colaborador a unidade(s) — módulo Gerencial.
--
-- `fa_kiosk_employees` nunca teve `unit_id`: é uma lista global desde a
-- origem. O que faltava era o próprio conceito de "este colaborador atua
-- nesta(s) unidade(s))" — daí a tabela de junção (muitos-para-muitos: um
-- colaborador pode atuar em mais de uma unidade). Só o RPC escreve nela
-- (mesmo padrão de fa_config_set_employee_role em 20260807000005): a
-- policy de authenticated não abre `insert`/`update`/`delete` diretos, e a
-- checagem de capacidade é a primeira instrução do corpo da função.

create table if not exists fa_kiosk_employee_units (
  employee_id uuid not null references fa_kiosk_employees(id) on delete cascade,
  unit_id uuid not null references fa_kiosk_units(id) on delete cascade,
  primary key (employee_id, unit_id)
);

alter table fa_kiosk_employee_units enable row level security;
drop policy if exists fa_kiosk_employee_units_read on fa_kiosk_employee_units;
create policy fa_kiosk_employee_units_read on fa_kiosk_employee_units for select to authenticated using (true);

create or replace function fa_config_set_employee_units(p_employee_id uuid, p_unit_ids uuid[]) returns void as $$
begin
  if not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para definir as unidades do colaborador' using errcode = '42501';
  end if;

  if not exists (select 1 from fa_kiosk_employees where id = p_employee_id) then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  delete from fa_kiosk_employee_units where employee_id = p_employee_id;

  insert into fa_kiosk_employee_units (employee_id, unit_id)
  select p_employee_id, unit_id from unnest(coalesce(p_unit_ids, array[]::uuid[])) as unit_id;

  perform fa_config_audit('CONFIG_EMPLOYEE_UNITS_SET',
                          jsonb_build_object('employeeId', p_employee_id, 'unitIds', p_unit_ids));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_set_employee_units(uuid, uuid[]) from public, anon;
grant execute on function fa_config_set_employee_units(uuid, uuid[]) to authenticated;
