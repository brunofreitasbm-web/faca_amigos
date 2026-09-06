-- Papel Prestador PJ (PRESTADOR_PJ): só registra frequência / prestação de serviço,
-- sem acesso ao caixa, PDV, check-in/saída, relatórios ou Configurações.
-- Nomenclatura blindada contra risco de vínculo empregatício.

alter table fa_kiosk_employees drop constraint if exists fa_kiosk_employees_role_check;
alter table fa_kiosk_employees add constraint fa_kiosk_employees_role_check
  check (role in ('ESTAGIARIO', 'OPERADOR', 'GERENTE', 'ADMIN', 'PRESTADOR_PJ'));

alter table fa_kiosk_role_capabilities drop constraint if exists fa_kiosk_role_capabilities_role_check;
alter table fa_kiosk_role_capabilities add constraint fa_kiosk_role_capabilities_role_check
  check (role in ('ESTAGIARIO', 'OPERADOR', 'GERENTE', 'ADMIN', 'PRESTADOR_PJ'));

alter table fa_kiosk_onboarding_invites drop constraint if exists fa_kiosk_onboarding_invites_role_check;
alter table fa_kiosk_onboarding_invites add constraint fa_kiosk_onboarding_invites_role_check
  check (role in ('ESTAGIARIO', 'OPERADOR', 'GERENTE', 'ADMIN', 'PRESTADOR_PJ'));

create or replace function fa_kiosk_role_rank(p_role text) returns int as $$
  select case p_role
    when 'ESTAGIARIO'    then 0
    when 'PRESTADOR_PJ'  then 0
    when 'OPERADOR'      then 1
    when 'GERENTE'       then 2
    when 'ADMIN'         then 3
    else 0
  end;
$$ language sql immutable set search_path = public, pg_temp;

insert into fa_kiosk_role_capabilities (role, capability) values
  ('PRESTADOR_PJ', 'ponto.self')
on conflict do nothing;

create or replace function fa_config_set_employee_role(p_employee_id uuid, p_role text) returns void as $$
declare
  v_old text;
begin
  if not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para alterar o papel de colaborador' using errcode = '42501';
  end if;
  if p_role not in ('ESTAGIARIO', 'OPERADOR', 'GERENTE', 'ADMIN', 'PRESTADOR_PJ') then
    raise exception 'papel inválido' using errcode = '22023';
  end if;

  select role into v_old from fa_kiosk_employees where id = p_employee_id;
  if v_old is null then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  update fa_kiosk_employees set role = p_role where id = p_employee_id;

  perform fa_config_audit('CONFIG_EMPLOYEE_ROLE_CHANGE',
                          jsonb_build_object('employeeId', p_employee_id, 'from', v_old, 'to', p_role));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
