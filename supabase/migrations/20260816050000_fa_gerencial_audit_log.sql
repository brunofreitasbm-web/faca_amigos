-- RPC de leitura do audit log (fa_kiosk_audit_log) para o menu Gerencial >
-- Auditoria. Até aqui a tabela só recebia INSERT (fa_config_audit, Edge
-- Functions de login/onboarding) — nada no sistema expunha esses registros
-- para consulta, então era impossível pela UI responder "quem fez o quê,
-- quando".
--
-- Diferente de fa_gerencial_clientes (que confia na tela escondida), esta
-- função checa fa_kiosk_can('config.write') explicitamente no corpo: é
-- trilha de auditoria, a autorização não pode depender só do botão sumir.
create or replace function fa_gerencial_audit_log(
  p_search text default null,
  p_employee_id uuid default null,
  p_severity text default null,
  p_start_ms bigint default null,
  p_end_ms bigint default null,
  p_limit int default 200
) returns jsonb as $$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_res jsonb;
begin
  if not fa_kiosk_can('config.write') then
    raise exception 'sem permissão para consultar auditoria' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_res
  from (
    select
      a.id,
      a.at_ms,
      a.action,
      a.severity,
      a.details_json,
      a.employee_id,
      e.full_name as employee_name,
      e.role as employee_role
    from fa_kiosk_audit_log a
    left join fa_kiosk_employees e on e.id = a.employee_id
    where (p_employee_id is null or a.employee_id = p_employee_id)
      and (p_severity is null or a.severity = p_severity)
      and (p_start_ms is null or a.at_ms >= p_start_ms)
      and (p_end_ms is null or a.at_ms <= p_end_ms)
      and (
        v_search = '' or
        a.action ilike '%' || v_search || '%' or
        e.full_name ilike '%' || v_search || '%'
      )
    order by a.at_ms desc, a.id desc
    limit least(coalesce(p_limit, 200), 500)
  ) item;

  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_gerencial_audit_log(text, uuid, text, bigint, bigint, int) from public, anon;
grant execute on function fa_gerencial_audit_log(text, uuid, text, bigint, bigint, int) to authenticated;
