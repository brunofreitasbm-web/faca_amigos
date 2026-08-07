-- RPCs de configuração — a camada que de fato protege o menu Configurações.
--
-- Esconder o botão no kiosk-ui é UX, não segurança: nada impede uma chamada
-- direta ao PostgREST com a publishable key. Toda mutação administrativa que
-- carrega regra de negócio ou dado sensível passa por uma função daqui, e
-- cada uma checa fa_kiosk_can() ANTES de tocar em qualquer linha.
--
-- Três invariantes em toda função deste arquivo:
--  1. Autorização é a primeira instrução do corpo. Nunca depois de um
--     update "inofensivo".
--  2. `revoke from public, anon` explícito — Postgres concede EXECUTE a
--     PUBLIC por padrão, então `grant to authenticated` sozinho não fecha
--     nada.
--  3. Trilha de auditoria na MESMA transação. Alteração de dado fiscal ou
--     de papel de colaborador sem registro de quem fez é exatamente o que
--     dói numa fiscalização ou numa apuração interna.

create or replace function fa_config_audit(p_action text, p_details jsonb) returns void as $$
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (fa_kiosk_current_employee_id(), p_action, 'ALERTA', p_details);
$$ language sql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_audit(text, jsonb) from public, anon, authenticated;

-- Campo opcional vindo do formulário: string vazia vira NULL, nunca ''.
create or replace function fa_config_text(p_payload jsonb, p_key text) returns text as $$
  select nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
$$ language sql immutable set search_path = public, pg_temp;

create or replace function fa_config_digits(p_payload jsonb, p_key text) returns text as $$
  select nullif(regexp_replace(coalesce(p_payload ->> p_key, ''), '\D', '', 'g'), '');
$$ language sql immutable set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- Unidades
-- ---------------------------------------------------------------------------
create or replace function fa_config_create_unit(p_payload jsonb) returns uuid as $$
declare
  v_id uuid;
begin
  if not fa_kiosk_can('config.unit.write') then
    raise exception 'sem permissão para cadastrar unidade' using errcode = '42501';
  end if;

  insert into fa_kiosk_units (kind, name, timezone, business_day_cutoff_hour)
  values (
    coalesce(fa_config_text(p_payload, 'kind'), 'LOJA'),
    fa_config_text(p_payload, 'name'),
    coalesce(fa_config_text(p_payload, 'timezone'), 'America/Belem'),
    coalesce((p_payload ->> 'businessDayCutoffHour')::int, 4)
  )
  returning id into v_id;

  perform fa_config_audit('CONFIG_UNIT_CREATE', jsonb_build_object('unitId', v_id, 'payload', p_payload));
  return v_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_create_unit(jsonb) from public, anon;
grant execute on function fa_config_create_unit(jsonb) to authenticated;

create or replace function fa_config_update_unit(p_unit_id uuid, p_payload jsonb) returns void as $$
begin
  if not fa_kiosk_can('config.unit.write') then
    raise exception 'sem permissão para editar a unidade' using errcode = '42501';
  end if;

  update fa_kiosk_units set
    name                     = coalesce(fa_config_text(p_payload, 'name'), name),
    timezone                 = coalesce(fa_config_text(p_payload, 'timezone'), timezone),
    business_day_cutoff_hour = coalesce((p_payload ->> 'businessDayCutoffHour')::int, business_day_cutoff_hour),
    address                  = fa_config_text(p_payload, 'address'),
    phone                    = fa_config_digits(p_payload, 'phone')
  where id = p_unit_id;

  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;

  perform fa_config_audit('CONFIG_UNIT_UPDATE', jsonb_build_object('unitId', p_unit_id, 'payload', p_payload));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_update_unit(uuid, jsonb) from public, anon;
grant execute on function fa_config_update_unit(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Dados fiscais da unidade (NFC-e + cadastro de NFS-e)
-- ---------------------------------------------------------------------------
create or replace function fa_config_update_unit_fiscal(p_unit_id uuid, p_payload jsonb) returns void as $$
begin
  if not fa_kiosk_can('config.fiscal.write') then
    raise exception 'sem permissão para editar dados fiscais' using errcode = '42501';
  end if;

  update fa_kiosk_units set
    cnpj                     = fa_config_digits(p_payload, 'cnpj'),
    razao_social             = fa_config_text(p_payload, 'razaoSocial'),
    nome_fantasia            = fa_config_text(p_payload, 'nomeFantasia'),
    inscricao_estadual       = fa_config_text(p_payload, 'inscricaoEstadual'),
    inscricao_municipal      = fa_config_text(p_payload, 'inscricaoMunicipal'),
    cnae_principal           = fa_config_text(p_payload, 'cnaePrincipal'),
    crt                      = coalesce((p_payload ->> 'crt')::smallint, 1),
    end_logradouro           = fa_config_text(p_payload, 'endLogradouro'),
    end_numero               = fa_config_text(p_payload, 'endNumero'),
    end_complemento          = fa_config_text(p_payload, 'endComplemento'),
    end_bairro               = fa_config_text(p_payload, 'endBairro'),
    end_municipio_ibge       = coalesce(fa_config_digits(p_payload, 'endMunicipioIbge'), '1501402'),
    end_uf                   = coalesce(fa_config_text(p_payload, 'endUf'), 'PA'),
    end_cep                  = fa_config_digits(p_payload, 'endCep'),
    fone                     = fa_config_digits(p_payload, 'fone'),
    -- NFC-e (modelo 65, mercadoria)
    fiscal_ambiente          = coalesce(fa_config_text(p_payload, 'fiscalAmbiente'), 'HOMOLOGACAO'),
    -- Kill switch: `= true` e não `<> false`. Payload sem a chave desliga a
    -- emissão em vez de mantê-la ligada — falha fechado, nunca aberto.
    fiscal_enabled           = (p_payload ->> 'fiscalEnabled') = 'true',
    nfce_serie               = coalesce((p_payload ->> 'nfceSerie')::int, 1),
    nfce_csc_id              = fa_config_text(p_payload, 'nfceCscId'),
    nfce_qrcode_url_consulta = fa_config_text(p_payload, 'nfceQrcodeUrlConsulta'),
    -- NFS-e (serviço, ISS) — cadastro apenas, emissão fora de escopo.
    nfse_item_lista_servico          = fa_config_text(p_payload, 'nfseItemListaServico'),
    nfse_codigo_tributacao_municipio = fa_config_text(p_payload, 'nfseCodigoTributacaoMunicipio'),
    nfse_aliquota_iss_bp             = coalesce((p_payload ->> 'nfseAliquotaIssBp')::int, 0),
    nfse_iss_retido                  = (p_payload ->> 'nfseIssRetido') = 'true',
    nfse_regime_especial             = coalesce((p_payload ->> 'nfseRegimeEspecial')::smallint, 6),
    nfse_serie_rps                   = coalesce(fa_config_text(p_payload, 'nfseSerieRps'), '1'),
    nfse_ambiente                    = coalesce(fa_config_text(p_payload, 'nfseAmbiente'), 'HOMOLOGACAO'),
    nfse_enabled                     = (p_payload ->> 'nfseEnabled') = 'true'
  where id = p_unit_id;

  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;

  perform fa_config_audit('CONFIG_FISCAL_UPDATE', jsonb_build_object('unitId', p_unit_id, 'payload', p_payload));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_update_unit_fiscal(uuid, jsonb) from public, anon;
grant execute on function fa_config_update_unit_fiscal(uuid, jsonb) to authenticated;

-- Tributação por produto (NCM/CFOP/CSOSN) — sem isso a NFC-e é rejeitada.
create or replace function fa_config_update_product_fiscal(p_product_id uuid, p_payload jsonb) returns void as $$
begin
  if not fa_kiosk_can('config.fiscal.write') then
    raise exception 'sem permissão para editar dados fiscais' using errcode = '42501';
  end if;

  update fa_kiosk_products set
    ncm               = fa_config_digits(p_payload, 'ncm'),
    cest              = fa_config_digits(p_payload, 'cest'),
    cfop              = coalesce(fa_config_text(p_payload, 'cfop'), '5102'),
    csosn             = coalesce(fa_config_text(p_payload, 'csosn'), '102'),
    origem            = coalesce((p_payload ->> 'origem')::smallint, 0),
    unidade_comercial = coalesce(fa_config_text(p_payload, 'unidadeComercial'), 'UN'),
    gtin              = coalesce(fa_config_text(p_payload, 'gtin'), 'SEM GTIN'),
    pis_cst           = coalesce(fa_config_text(p_payload, 'pisCst'), '49'),
    cofins_cst        = coalesce(fa_config_text(p_payload, 'cofinsCst'), '49')
  where id = p_product_id;

  if not found then
    raise exception 'produto não encontrado' using errcode = 'P0002';
  end if;

  perform fa_config_audit('CONFIG_PRODUCT_FISCAL_UPDATE',
                          jsonb_build_object('productId', p_product_id, 'payload', p_payload));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_update_product_fiscal(uuid, jsonb) from public, anon;
grant execute on function fa_config_update_product_fiscal(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Termos de Uso
-- ---------------------------------------------------------------------------
-- Guardado em fa_kiosk_app_settings (chave 'terms_of_use'), que já é lido
-- pelo fluxo de Entrada. Capacidade própria (config.terms.write) porque é o
-- texto que o responsável aceita no check-in: alterá-lo tem efeito jurídico,
-- não é um ajuste operacional como meta do dia.
create or replace function fa_config_set_terms(p_unit_id uuid, p_terms text) returns void as $$
begin
  if not fa_kiosk_can('config.terms.write') then
    raise exception 'sem permissão para editar os termos de uso' using errcode = '42501';
  end if;

  insert into fa_kiosk_app_settings (unit_id, key, value, updated_at_ms)
  values (p_unit_id, 'terms_of_use', coalesce(p_terms, ''), (extract(epoch from now()) * 1000)::bigint)
  on conflict (unit_id, key) do update
    set value = excluded.value, updated_at_ms = excluded.updated_at_ms;

  -- Guarda o texto inteiro, não um "mudou": a pergunta que importa depois é
  -- "o que exatamente o responsável aceitou naquele dia".
  perform fa_config_audit('CONFIG_TERMS_UPDATE',
                          jsonb_build_object('unitId', p_unit_id, 'terms', p_terms));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_set_terms(uuid, text) from public, anon;
grant execute on function fa_config_set_terms(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Colaboradores
-- ---------------------------------------------------------------------------
-- Criar colaborador continua na Edge Function admin-create-employee (exige
-- service role para mexer em auth.users). O que muda de papel/estado passa
-- por aqui, para ficar auditado e para o guard do último Owner disparar.
create or replace function fa_config_set_employee_role(p_employee_id uuid, p_role text) returns void as $$
declare
  v_old text;
begin
  if not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para alterar o papel de colaborador' using errcode = '42501';
  end if;
  if p_role not in ('OPERADOR', 'GERENTE', 'ADMIN') then
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

revoke execute on function fa_config_set_employee_role(uuid, text) from public, anon;
grant execute on function fa_config_set_employee_role(uuid, text) to authenticated;

create or replace function fa_config_set_employee_active(p_employee_id uuid, p_active boolean) returns void as $$
begin
  if not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para ativar/desativar colaborador' using errcode = '42501';
  end if;

  update fa_kiosk_employees set active = p_active where id = p_employee_id;
  if not found then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  -- Desativar zera a trava de força bruta: sem isso, um colaborador
  -- reativado depois de um ataque volta já bloqueado.
  if not p_active then
    delete from fa_kiosk_pin_attempts where employee_id = p_employee_id;
  end if;

  perform fa_config_audit('CONFIG_EMPLOYEE_ACTIVE_CHANGE',
                          jsonb_build_object('employeeId', p_employee_id, 'active', p_active));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_set_employee_active(uuid, boolean) from public, anon;
grant execute on function fa_config_set_employee_active(uuid, boolean) to authenticated;
