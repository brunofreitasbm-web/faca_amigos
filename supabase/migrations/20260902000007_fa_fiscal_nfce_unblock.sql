-- =====================================================================
-- Destrava a emissão real de NFC-e: cadastro que faltava + payload do worker.
--
-- O que o worker (apps/kiosk/src/fiscal) precisa e não tinha:
--  1. Nome do município do emitente (xMun) — o XML exige o nome, não só o
--     código IBGE. Coluna nova `end_municipio_nome`, preenchida como BELEM
--     onde o IBGE já é 1501402.
--  2. Saneamento de lixo de formulário que virava rejeição: '0' em
--     nfse_codigo_tributacao_municipio e '.' em inscricao_municipal eram
--     "preenchido" pro validador, mas inválidos pra prefeitura. Viram NULL
--     aqui e a RPC de configuração passa a impedir que voltem.
--  3. `qrcode_url` no documento: a URL completa do QR Code da NFC-e
--     autorizada, pra reimpressão do DANFE sem remontar o hash com o CSC.
--  4. Bucket `fiscal-xml` (prometido desde a migration 20260806000032, nunca
--     criado): cópia do XML autorizado sai do PC do balcão pra cá.
--  5. fa_fiscal_claim_next passa a entregar tudo isso numa ida só, e a
--     contar a tentativa NO CLAIM (attempts = attempts + 1): antes o worker
--     é que incrementava, e um worker que morria no meio deixava o contador
--     parado e o documento sem backoff.
-- =====================================================================

-- 1. Nome do município do emitente
alter table fa_kiosk_units add column if not exists end_municipio_nome text;

update fa_kiosk_units
   set end_municipio_nome = 'BELEM'
 where end_municipio_ibge = '1501402'
   and end_municipio_nome is null;

-- 2. Saneamento de placeholders inválidos
update fa_kiosk_units
   set nfse_codigo_tributacao_municipio = null
 where btrim(coalesce(nfse_codigo_tributacao_municipio, '')) in ('', '0');

update fa_kiosk_units
   set inscricao_municipal = null
 where btrim(coalesce(inscricao_municipal, '')) in ('', '.');

-- 3. URL do QR Code da NFC-e autorizada
alter table fa_kiosk_fiscal_docs add column if not exists qrcode_url text;

-- 4. Bucket privado do XML — zero policies de storage.objects de propósito,
-- mesmo desenho de `fiscal-certificados` (migration 20260819000002). Só
-- service_role (worker) toca esses arquivos.
insert into storage.buckets (id, name, public)
values ('fiscal-xml', 'fiscal-xml', false)
on conflict (id) do nothing;

-- 5. fa_fiscal_claim_next: o consumidor da fila (base: migration 33).
--
-- `for update skip locked` é o que permite dois terminais rodarem ao mesmo
-- tempo sem emitir nota duplicada — eles se revezam em vez de brigar. É a
-- mitigação M4 do plano (segundo terminal como failover).
--
-- Devolve o payload COMPLETO (documento + venda + itens + emitente) numa ida
-- só, para o worker não precisar de cinco round-trips por nota.
create or replace function fa_fiscal_claim_next(p_terminal_id text, p_limit integer default 5)
returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_result jsonb;
begin
  with picked as (
    select id from fa_kiosk_fiscal_docs
    where status in ('PENDENTE', 'ASSINADO', 'TRANSMITIDO', 'CONTINGENCIA_OFFLINE')
      and next_attempt_at_ms <= v_now_ms
    order by created_at_ms
    limit greatest(p_limit, 1)
    for update skip locked
  ), claimed as (
    update fa_kiosk_fiscal_docs d
      set claimed_by = p_terminal_id,
          claimed_at_ms = v_now_ms,
          -- A tentativa conta no claim, não no fim: worker que morre no meio
          -- não deixa o contador parado.
          attempts = d.attempts + 1,
          updated_at_ms = v_now_ms
      from picked
      where d.id = picked.id
      returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc', jsonb_build_object(
      'id', c.id,
      'docType', c.doc_type,
      'environment', c.environment,
      'status', c.status,
      'emissionType', c.emission_type,
      'serie', c.serie,
      'rpsSerie', c.rps_serie,
      'numero', c.numero,
      'accessKey', c.access_key,
      'qrcodeUrl', c.qrcode_url,
      'attempts', c.attempts,
      'totalCents', c.total_cents
    ),
    'order', jsonb_build_object(
      'id', o.id,
      'orderCode', o.order_code,
      'businessDate', o.business_date,
      'closedAtMs', o.closed_at_ms,
      'fiscalCpf', o.fiscal_cpf,
      'fiscalNome', o.fiscal_nome,
      'fiscalEmail', o.fiscal_email
    ),
    'unit', jsonb_build_object(
      'id', u.id,
      'cnpj', u.cnpj,
      'razaoSocial', u.razao_social,
      'nomeFantasia', u.nome_fantasia,
      'inscricaoEstadual', u.inscricao_estadual,
      'crt', u.crt,
      'endLogradouro', u.end_logradouro,
      'endNumero', u.end_numero,
      'endComplemento', u.end_complemento,
      'endBairro', u.end_bairro,
      'endMunicipioIbge', u.end_municipio_ibge,
      'endMunicipioNome', u.end_municipio_nome,
      'endUf', u.end_uf,
      'endCep', u.end_cep,
      'fone', u.fone,
      'timezone', u.timezone,
      'nfceSerie', u.nfce_serie,
      'fiscalAmbiente', u.fiscal_ambiente,
      'nfceCscId', u.nfce_csc_id,
      'nfceQrcodeUrlConsulta', u.nfce_qrcode_url_consulta
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'description', i.description,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents,
        'productId', i.product_id,
        'ncm', p.ncm,
        'cest', p.cest,
        'cfop', p.cfop,
        'csosn', p.csosn,
        'origem', p.origem,
        'unidadeComercial', p.unidade_comercial,
        'gtin', p.gtin,
        'pisCst', p.pis_cst,
        'cofinsCst', p.cofins_cst,
        'fiscalReady', p.fiscal_ready
      ) order by i.description), '[]'::jsonb)
      from fa_kiosk_order_items i
      left join fa_kiosk_products p on p.id = i.product_id
      where i.order_id = o.id and i.item_nature = 'PRODUTO'
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', pay.method,
        'amountCents', pay.amount_cents
      )), '[]'::jsonb)
      from fa_kiosk_payments pay where pay.order_id = o.id
    )
  )), '[]'::jsonb)
  into v_result
  from claimed c
  join fa_kiosk_orders o on o.id = c.order_id
  join fa_kiosk_units u on u.id = c.unit_id;

  return v_result;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Só o worker (service_role) dispara o claim — reaplica o que a migration
-- 20260807000003 (seção 5) fez, já que o `create or replace` acima é a
-- primeira redefinição desde então.
revoke execute on function fa_fiscal_claim_next(text, integer) from public, anon, authenticated;
grant execute on function fa_fiscal_claim_next(text, integer) to service_role;

-- 6. fa_config_update_unit_fiscal (base: migration 20260807000005).
-- Ganha `endMunicipioNome` e barra os placeholders do item 2 na origem:
-- '0' em código de tributação e '.' em inscrição municipal viram NULL.
-- Todo o resto é idêntico ao original.
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
    -- '.' era o jeito do formulário "preencher" o campo obrigatório sem ter
    -- o dado; a prefeitura rejeita. Sem IM de verdade, fica NULL.
    inscricao_municipal      = nullif(fa_config_text(p_payload, 'inscricaoMunicipal'), '.'),
    cnae_principal           = fa_config_text(p_payload, 'cnaePrincipal'),
    crt                      = coalesce((p_payload ->> 'crt')::smallint, 1),
    end_logradouro           = fa_config_text(p_payload, 'endLogradouro'),
    end_numero               = fa_config_text(p_payload, 'endNumero'),
    end_complemento          = fa_config_text(p_payload, 'endComplemento'),
    end_bairro               = fa_config_text(p_payload, 'endBairro'),
    end_municipio_ibge       = coalesce(fa_config_digits(p_payload, 'endMunicipioIbge'), '1501402'),
    -- Nome do município (xMun do XML): payload sem a chave mantém o atual,
    -- nunca apaga — o valor semeado (BELEM) não pode sumir por um salvar
    -- de formulário antigo que ainda não manda o campo.
    end_municipio_nome       = coalesce(nullif(fa_config_text(p_payload, 'endMunicipioNome'), ''), end_municipio_nome),
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
    -- NFS-e (serviço, ISS)
    nfse_item_lista_servico          = fa_config_text(p_payload, 'nfseItemListaServico'),
    -- '0' não é código de tributação municipal válido — mesmo caso do '.' acima.
    nfse_codigo_tributacao_municipio = nullif(fa_config_text(p_payload, 'nfseCodigoTributacaoMunicipio'), '0'),
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
