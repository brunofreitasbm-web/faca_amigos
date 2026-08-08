-- Espelho de Ponto para auditoria: o cabeçalho impresso hoje só tinha
-- nome/CPF/função/jornada. Passa a trazer também os dados de documento
-- (RG, CTPS) já coletados no cadastro por convite, data de nascimento, e a
-- identificação fiscal completa da(s) unidade(s) em que o colaborador atua
-- (razão social, CNPJ, endereço) — a data de emissão em si não precisa vir
-- do banco, é o momento em que a tela gera o HTML de impressão.
create or replace function fa_kiosk_espelho_ponto(p_employee_id uuid, p_year int, p_month int)
returns jsonb as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_employee jsonb;
  v_records jsonb;
  v_units jsonb;
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
      select
        e.id, e.full_name, e.cpf, e.position, e.role, e.admission_date,
        e.weekly_hours_contracted, e.birth_date,
        pi.rg_numero, pi.rg_orgao_emissor,
        pi.ctps_numero, pi.ctps_serie, pi.ctps_uf
        from fa_kiosk_employees e
        left join fa_kiosk_employee_personal_info pi on pi.employee_id = e.id
       where e.id = p_employee_id
    ) row;

  -- Unidade(s) em que o colaborador atua (fa_kiosk_employee_units, o
  -- muitos-para-muitos real — e.unit_id acima é só legado, usado só pro
  -- fuso horário). Um colaborador pode ter mais de uma linha aqui.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', u.name,
           'razaoSocial', u.razao_social,
           'nomeFantasia', u.nome_fantasia,
           'cnpj', u.cnpj,
           'address', u.address,
           'phone', coalesce(u.phone, u.fone)
         ) order by u.name), '[]'::jsonb)
    into v_units
    from fa_kiosk_employee_units eu
    join fa_kiosk_units u on u.id = eu.unit_id
   where eu.employee_id = p_employee_id;

  select coalesce(jsonb_agg(jsonb_build_object('atMs', at_ms, 'kind', kind, 'nsr', nsr) order by at_ms), '[]'::jsonb)
    into v_records
    from fa_kiosk_ponto_records
   where employee_id = p_employee_id
     and to_timestamp(at_ms / 1000.0) >= v_from
     and to_timestamp(at_ms / 1000.0) < v_to;

  return jsonb_build_object(
    'employee', v_employee,
    'units', v_units,
    'records', v_records,
    'year', p_year,
    'month', p_month,
    'timezone', v_tz
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_espelho_ponto(uuid, int, int) from public, anon;
grant execute on function fa_kiosk_espelho_ponto(uuid, int, int) to authenticated;
