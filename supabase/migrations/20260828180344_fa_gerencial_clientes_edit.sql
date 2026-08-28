-- Permite ao Owner editar os dados de Responsável e Crianças Vinculadas
-- direto no modal de detalhes do Gerencial > Clientes. Até aqui essas
-- tabelas só tinham SELECT liberado (ver 20260806000009_fa_kiosk_rls.sql e
-- 20260810000003_fa_security_audit_fixes.sql, que removeu um UPDATE aberto
-- "authenticated_full_access" por ser inseguro) — qualquer escrita precisa
-- passar por uma RPC security definer que valide a capacidade, como o resto
-- do RBAC (ver fa_kiosk_can em 20260807000002_fa_rbac_capabilities.sql).

insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'clientes.write')
on conflict do nothing;

create or replace function fa_gerencial_update_guardian(
  p_guardian_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_cpf text default null,
  p_email text default null
) returns void as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_phone text := trim(coalesce(p_phone_e164, ''));
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  if not fa_kiosk_can('clientes.write') then
    raise exception 'sem permissão para editar dados de clientes' using errcode = '42501';
  end if;

  if v_full_name = '' then
    raise exception 'nome do responsável é obrigatório' using errcode = '22023';
  end if;
  if v_phone = '' then
    raise exception 'telefone do responsável é obrigatório' using errcode = '22023';
  end if;
  if v_cpf is not null and length(v_cpf) <> 11 then
    raise exception 'CPF deve conter 11 dígitos numéricos' using errcode = '22023';
  end if;

  update fa_kiosk_guardians
  set full_name = v_full_name,
      phone_e164 = v_phone,
      cpf = v_cpf,
      email = v_email
  where id = p_guardian_id;

  if not found then
    raise exception 'responsável não encontrado' using errcode = 'P0002';
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (fa_kiosk_current_employee_id(), 'GERENCIAL_UPDATE_GUARDIAN', 'INFO',
          jsonb_build_object('guardianId', p_guardian_id));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_gerencial_update_guardian(uuid, text, text, text, text) from public, anon;
grant execute on function fa_gerencial_update_guardian(uuid, text, text, text, text) to authenticated;

create or replace function fa_gerencial_update_child(
  p_child_id uuid,
  p_full_name text,
  p_birth_date date
) returns void as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
begin
  if not fa_kiosk_can('clientes.write') then
    raise exception 'sem permissão para editar dados de clientes' using errcode = '42501';
  end if;

  if v_full_name = '' then
    raise exception 'nome da criança é obrigatório' using errcode = '22023';
  end if;
  if p_birth_date is null then
    raise exception 'data de nascimento é obrigatória' using errcode = '22023';
  end if;

  update fa_kiosk_children
  set full_name = v_full_name,
      birth_date = p_birth_date
  where id = p_child_id;

  if not found then
    raise exception 'criança não encontrada' using errcode = 'P0002';
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (fa_kiosk_current_employee_id(), 'GERENCIAL_UPDATE_CHILD', 'INFO',
          jsonb_build_object('childId', p_child_id));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_gerencial_update_child(uuid, text, date) from public, anon;
grant execute on function fa_gerencial_update_child(uuid, text, date) to authenticated;
