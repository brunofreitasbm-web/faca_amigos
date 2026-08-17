-- Restringir a capacidade 'sessao.cancel' exclusivamente para o perfil Owner (ADMIN).
-- Anteriormente concedida a GERENTE (Líder), passando a herdar exclusivamente a partir do ADMIN.

delete from fa_kiosk_role_capabilities where capability = 'sessao.cancel';

insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'sessao.cancel')
on conflict do nothing;

create or replace function fa_kiosk_guard_session_exception() returns trigger as $$
begin
  if fa_kiosk_current_employee_id() is null then
    return new;
  end if;
  -- Só o que muda o plano já vendido ou cancela a sessão. Check-in, checkout e
  -- os eventos normais de atendimento continuam liberados ao Operador.
  if new.plan_id is distinct from old.plan_id and not fa_kiosk_can('sessao.change_plan') then
    raise exception 'apenas um líder ou o proprietário pode trocar o plano de uma sessão em andamento'
      using errcode = '42501';
  end if;
  if new.status = 'FINALIZADA' and old.status = 'ATIVA'
     and new.checkout_at_ms is null and not fa_kiosk_can('sessao.cancel') then
    raise exception 'apenas o proprietário (Owner) pode cancelar uma sessão sem checkout'
      using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
