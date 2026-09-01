-- Migration: Reset de biometria facial de colaboradores e RPC fa_kiosk_reset_face

create or replace function fa_kiosk_reset_face(p_employee_id uuid) returns void as $$
declare
  v_caller_id uuid := fa_kiosk_current_employee_id();
begin
  if v_caller_id is null then
    raise exception 'não autenticado';
  end if;
  if p_employee_id <> v_caller_id and not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para resetar a biometria de outro colaborador' using errcode = '42501';
  end if;

  update fa_kiosk_employees
     set face_descriptor = null,
         face_enrolled_photo_path = null
   where id = p_employee_id;

  if not found then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (v_caller_id, 'FACE_RESET', 'ALERTA', jsonb_build_object('employeeId', p_employee_id));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_reset_face(uuid) from public, anon;
grant execute on function fa_kiosk_reset_face(uuid) to authenticated;

-- Reset imediato da biometria da colaboradora Luciane
update fa_kiosk_employees
   set face_descriptor = null,
       face_enrolled_photo_path = null
 where full_name ilike '%Luciane%';

insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
select id, 'FACE_RESET', 'ALERTA', jsonb_build_object('employeeId', id, 'reason', 'Solicitação de reset de biometria para Luciane')
  from fa_kiosk_employees
 where full_name ilike '%Luciane%';
