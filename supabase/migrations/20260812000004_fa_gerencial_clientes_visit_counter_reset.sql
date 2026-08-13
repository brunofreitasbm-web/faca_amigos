-- "Zerar visitas" pedido pelo Owner no menu Clientes do Gerencial, sem
-- apagar o histórico real de check-ins (fa_kiosk_sessions é usado em
-- relatórios, faturamento e trilha de auditoria — excluir linhas ali seria
-- destrutivo e irreversível).
--
-- Em vez disso: uma linha única guarda o timestamp do último "reset", e
-- fa_gerencial_clientes passa a contar só as visitas com checkin_at_ms a
-- partir dali. O histórico completo continua no banco, só não entra na
-- contagem exibida — reversível a qualquer momento (bastaria zerar
-- reset_at_ms de novo).
create table if not exists fa_kiosk_visit_counter_reset (
  id boolean primary key default true,
  reset_at_ms bigint not null default 0,
  reset_by_employee_id uuid references fa_kiosk_employees (id),
  check (id)
);

insert into fa_kiosk_visit_counter_reset (id, reset_at_ms)
values (true, 0)
on conflict (id) do nothing;

alter table fa_kiosk_visit_counter_reset enable row level security;

drop policy if exists fa_kiosk_visit_counter_reset_read on fa_kiosk_visit_counter_reset;
create policy fa_kiosk_visit_counter_reset_read on fa_kiosk_visit_counter_reset
  for select to authenticated using (true);
-- Sem policy de escrita: só a RPC abaixo (security definer) altera.

create or replace function fa_config_reset_visit_counter() returns void as $$
begin
  if not fa_kiosk_can('config.write') then
    raise exception 'sem permissão para reiniciar o contador de visitas' using errcode = '42501';
  end if;

  update fa_kiosk_visit_counter_reset
  set reset_at_ms = (extract(epoch from now()) * 1000)::bigint,
      reset_by_employee_id = fa_kiosk_current_employee_id()
  where id = true;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (fa_kiosk_current_employee_id(), 'CONFIG_RESET_VISIT_COUNTER', 'ALERTA', '{}'::jsonb);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_reset_visit_counter() from public, anon;
grant execute on function fa_config_reset_visit_counter() to authenticated;

create or replace function fa_gerencial_clientes(
  p_search text default null,
  p_unit_id uuid default null
) returns jsonb as $$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_reset_at_ms bigint := coalesce((select reset_at_ms from fa_kiosk_visit_counter_reset where id = true), 0);
  v_res jsonb;
begin
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_res
  from (
    select
      g.id as guardian_id,
      g.full_name as guardian_name,
      g.cpf,
      g.phone_e164,
      g.email,
      g.created_at,
      (
        select count(distinct s.id)
        from fa_kiosk_sessions s
        where s.guardian_id = g.id
          and s.checkin_at_ms >= v_reset_at_ms
          and (p_unit_id is null or s.unit_id = p_unit_id)
      ) as total_visits,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id,
          'fullName', c.full_name,
          'birthDate', c.birth_date,
          'photoPath', c.photo_path
        )), '[]'::jsonb)
        from fa_kiosk_child_guardians cg
        join fa_kiosk_children c on c.id = cg.child_id
        where cg.guardian_id = g.id
      ) as children
    from fa_kiosk_guardians g
    where (
      v_search = '' or
      g.full_name ilike '%' || v_search || '%' or
      g.cpf ilike '%' || v_search || '%' or
      g.phone_e164 ilike '%' || v_search || '%' or
      exists (
        select 1 from fa_kiosk_child_guardians cg2
        join fa_kiosk_children c2 on c2.id = cg2.child_id
        where cg2.guardian_id = g.id and c2.full_name ilike '%' || v_search || '%'
      )
    )
    order by total_visits desc, g.created_at desc
    limit 150
  ) item;

  return v_res;
end;
$$ language plpgsql stable security definer;

grant execute on function fa_gerencial_clientes(text, uuid) to anon, authenticated, service_role;
