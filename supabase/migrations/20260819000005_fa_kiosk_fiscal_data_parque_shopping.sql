-- =====================================================================
-- Preenchimento dos dados fiscais oficiais (CNPJ, IE, Simples Nacional,
-- endereço) das unidades do Parque Shopping (Playground e Circuito),
-- extraídos do CNPJ, Inscrição Estadual, Contrato Social e Termo de
-- Deferimento do Simples Nacional fornecidos pelo usuário em 2026-08-19.
-- Inclui também o código de tributação nacional (cTribNac) da NFS-e —
-- item 12.05.01, "Parques de diversão e centros de lazer", confirmado
-- com o usuário — para as duas unidades ficarem prontas para o cadastro
-- de emissão assim que o certificado A1 for enviado.
-- =====================================================================

update fa_kiosk_units
set
  cnpj = '66.318.630/0001-17',
  razao_social = 'FAÇA AMIGOS BRINQUEDOTECA LTDA',
  nome_fantasia = 'FAÇA AMIGOS',
  inscricao_estadual = '75.105.192-6',
  cnae_principal = '9321-2-00',
  crt = 1, -- Simples Nacional (Termo de Deferimento, efeitos desde 17/04/2026)
  end_logradouro = 'Rod. Augusto Montenegro',
  end_numero = '4300',
  end_complemento = 'Parque Shopping, 1º Piso - PSB01003',
  end_bairro = 'Parque Verde',
  end_municipio_ibge = '1501402', -- Belém / PA
  end_uf = 'PA',
  end_cep = '66635-110',
  fone = '(91) 98250-1215',
  address = 'Rod. Augusto Montenegro, 4300 - Parque Shopping Belém, Piso PSB01003, Parque Verde, Belém/PA - CEP 66635-110',
  phone = '(91) 98250-1215',
  nfse_item_lista_servico = '120501'
where name ilike '%Parque Shopping%';
