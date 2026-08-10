-- =====================================================================
-- Preenchimento dos dados fiscais oficiais da empresa Faça Amigos
-- para as unidades Playground (Parque Shopping) e Circuito (Parque Shopping)
-- extraídos da documentação CNPJ/IE/Sintegra.
-- =====================================================================

update fa_kiosk_units
set
  cnpj = '66.318.630/0001-17',
  razao_social = 'FAÇA AMIGOS BRINQUEDOTECA LTDA',
  nome_fantasia = 'FAÇA AMIGOS',
  inscricao_estadual = '75.105.192-6',
  cnae_principal = '9321-2-00',
  crt = 1, -- Simples Nacional
  end_logradouro = 'Rod. Augusto Montenegro',
  end_numero = '4300',
  end_complemento = 'Parque Shopping, 1º Piso - PSB01003',
  end_bairro = 'Parque Verde',
  end_municipio_ibge = '1501402', -- Belém / PA
  end_uf = 'PA',
  end_cep = '66635-110',
  fone = '(91) 98250-1215',
  address = 'Rod. Augusto Montenegro, 4300 - Parque Shopping Belém, Piso PSB01003, Parque Verde, Belém/PA - CEP 66635-110',
  phone = '(91) 98250-1215'
where name ilike '%Parque Shopping%' or name ilike '%Circuito%' or name ilike '%Playground%';
