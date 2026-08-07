-- Espelho de Ponto Mensal — capacidade nova + RPC de leitura agregada.
--
-- Não existia, até aqui, nenhuma capacidade para ler o ponto de OUTRO
-- colaborador (só `ponto.self`, usada para bater o próprio ponto). Gerar o
-- espelho mensal de alguém é justamente isso — um Líder/Owner consultando
-- marcações de terceiros — então precisa da própria entrada na matriz,
-- e não pode reaproveitar `relatorio.read` (que é sobre relatório de caixa,
-- não sobre dado de ponto do colaborador).
insert into fa_kiosk_role_capabilities (role, capability) values
  ('GERENTE', 'relatorio.ponto')
on conflict do nothing;

-- Agrega as marcações de ponto de um colaborador num mês de referência,
-- junto com os dados de identificação exigidos no cabeçalho da impressão
-- (nome, CPF, função). Nunca inclui PIN/hash — a tabela de credenciais
-- (fa_kiosk_local_credentials) não é tocada aqui.
--
-- Mês calculado no fuso da unidade do colaborador (fa_kiosk_units.timezone),
-- não em UTC cru — bater ponto às 23h50 locais não pode cair no dia
-- seguinte do espelho.
create or replace function fa_kiosk_espelho_ponto(p_employee_id uuid, p_year int, p_month int)
returns jsonb as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_employee jsonb;
  v_records jsonb;
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

  v_from := make_timestamptz(p_year, p_month, 1, 0, 0, 0, v_tz);
  v_to := v_from + interval '1 month';

  select to_jsonb(row) into v_employee
    from (
      select id, full_name, cpf, position, role, admission_date, weekly_hours_contracted
        from fa_kiosk_employees
       where id = p_employee_id
    ) row;

  select coalesce(jsonb_agg(jsonb_build_object('atMs', at_ms, 'kind', kind, 'nsr', nsr) order by at_ms), '[]'::jsonb)
    into v_records
    from fa_kiosk_ponto_records
   where employee_id = p_employee_id
     and to_timestamp(at_ms / 1000.0) >= v_from
     and to_timestamp(at_ms / 1000.0) < v_to;

  return jsonb_build_object(
    'employee', v_employee,
    'records', v_records,
    'year', p_year,
    'month', p_month,
    'timezone', v_tz
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_espelho_ponto(uuid, int, int) from public, anon;
grant execute on function fa_kiosk_espelho_ponto(uuid, int, int) to authenticated;
