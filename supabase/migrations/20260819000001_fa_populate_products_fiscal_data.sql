-- =====================================================================
-- Preenchimento e saneamento dos dados tributários dos produtos (NFC-e)
-- para emissão automática de cupom fiscal na venda de mercadorias.
-- =====================================================================

-- 1. Água Mineral (Garrafas / Copos)
update fa_kiosk_products
set
  ncm = '22011000',
  cest = '0300500',
  cfop = '5102',
  csosn = '102',
  origem = 0,
  unidade_comercial = 'UN',
  gtin = 'SEM GTIN',
  pis_cst = '49',
  cofins_cst = '49'
where name ilike '%Água%' or name ilike '%Agua%';

-- 2. Meias Antiderrapantes
update fa_kiosk_products
set
  ncm = '61159500',
  cfop = '5102',
  csosn = '102',
  origem = 0,
  unidade_comercial = 'UN',
  gtin = 'SEM GTIN',
  pis_cst = '49',
  cofins_cst = '49'
where name ilike '%Meia%';

-- 3. Sucos e Bebidas
update fa_kiosk_products
set
  ncm = '20098990',
  cfop = '5102',
  csosn = '102',
  origem = 0,
  unidade_comercial = 'UN',
  gtin = 'SEM GTIN',
  pis_cst = '49',
  cofins_cst = '49'
where name ilike '%Suco%';

-- 4. Brinquedos e demais mercadorias vendidas no quiosque (NCM Genérico de Brinquedos: 9503.00.99)
update fa_kiosk_products
set
  ncm = coalesce(nullif(ncm, ''), '95030099'),
  cfop = coalesce(nullif(cfop, ''), '5102'),
  csosn = coalesce(nullif(csosn, ''), '102'),
  origem = coalesce(origem, 0),
  unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
  gtin = coalesce(nullif(gtin, ''), 'SEM GTIN'),
  pis_cst = coalesce(nullif(pis_cst, ''), '49'),
  cofins_cst = coalesce(nullif(cofins_cst, ''), '49')
where ncm is null or length(ncm) != 8;

-- 5. Atualização da URL padrão de consulta do QR Code para SEFAZ-PA (SVRS) se nula
update fa_kiosk_units
set
  nfce_qrcode_url_consulta = coalesce(nullif(nfce_qrcode_url_consulta, ''), 'http://www.sefa.pa.gov.br/nfce/consulta'),
  nfce_serie = coalesce(nfce_serie, 1),
  nfce_csc_id = coalesce(nullif(nfce_csc_id, ''), '000002')
where nfce_qrcode_url_consulta is null or nfce_csc_id is null;
