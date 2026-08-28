-- =====================================================================
-- Migration: Replicar dados fiscais do Playground (Parque Shopping)
-- para a unidade Circuito (Parque Shopping)
-- =====================================================================

do $$
declare
  v_source fa_kiosk_units%rowtype;
begin
  -- Busca a unidade origem: Playground (Parque Shopping)
  select * into v_source
  from fa_kiosk_units
  where name ilike '%Playground%' and name ilike '%Parque Shopping%'
  order by created_at desc
  limit 1;

  if v_source.id is null then
    select * into v_source
    from fa_kiosk_units
    where name ilike '%Playground%'
    order by created_at desc
    limit 1;
  end if;

  if v_source.id is not null then
    update fa_kiosk_units
    set
      cnpj = coalesce(v_source.cnpj, '66.318.630/0001-17'),
      razao_social = coalesce(v_source.razao_social, 'FAÇA AMIGOS BRINQUEDOTECA LTDA'),
      nome_fantasia = coalesce(v_source.nome_fantasia, 'FAÇA AMIGOS'),
      inscricao_estadual = coalesce(v_source.inscricao_estadual, '75.105.192-6'),
      inscricao_municipal = v_source.inscricao_municipal,
      cnae_principal = coalesce(v_source.cnae_principal, '9321-2-00'),
      crt = coalesce(v_source.crt, 1),
      end_logradouro = coalesce(v_source.end_logradouro, 'Rod. Augusto Montenegro'),
      end_numero = coalesce(v_source.end_numero, '4300'),
      end_complemento = coalesce(v_source.end_complemento, 'Parque Shopping, 1º Piso - PSB01003'),
      end_bairro = coalesce(v_source.end_bairro, 'Parque Verde'),
      end_municipio_ibge = coalesce(v_source.end_municipio_ibge, '1501402'),
      end_uf = coalesce(v_source.end_uf, 'PA'),
      end_cep = coalesce(v_source.end_cep, '66635-110'),
      fone = coalesce(v_source.fone, '(91) 98250-1215'),
      phone = coalesce(v_source.phone, '(91) 98250-1215'),
      address = coalesce(v_source.address, 'Rod. Augusto Montenegro, 4300 - Parque Shopping Belém, Piso PSB01003, Parque Verde, Belém/PA - CEP 66635-110'),
      fiscal_ambiente = coalesce(v_source.fiscal_ambiente, 'PRODUCAO'),
      fiscal_enabled = coalesce(v_source.fiscal_enabled, true),
      nfce_serie = coalesce(v_source.nfce_serie, 1),
      nfce_csc_id = coalesce(v_source.nfce_csc_id, '000002'),
      nfce_qrcode_url_consulta = coalesce(v_source.nfce_qrcode_url_consulta, 'http://www.sefa.pa.gov.br/nfce/consulta'),
      nfse_item_lista_servico = coalesce(v_source.nfse_item_lista_servico, '120501'),
      nfse_codigo_tributacao_municipio = v_source.nfse_codigo_tributacao_municipio,
      nfse_aliquota_iss_bp = v_source.nfse_aliquota_iss_bp,
      nfse_iss_retido = coalesce(v_source.nfse_iss_retido, false),
      nfse_regime_especial = coalesce(v_source.nfse_regime_especial, 6),
      nfse_serie_rps = coalesce(v_source.nfse_serie_rps, '1'),
      nfse_ambiente = coalesce(v_source.nfse_ambiente, 'HOMOLOGACAO'),
      nfse_enabled = coalesce(v_source.nfse_enabled, false)
    where (name ilike '%Circuito%' or name ilike '%Quiosque%') and id != v_source.id;
  end if;
end $$;
