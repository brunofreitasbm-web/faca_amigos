-- =====================================================================
-- Ativação do Ambiente de Produção NFC-e para as Unidades
-- Playground (Parque Shopping) e Circuito (Parque Shopping)
-- Parametrização do idCSC = '000002', fiscal_ambiente = 'PRODUCAO'
-- e ativação da emissão fiscal.
-- =====================================================================

update fa_kiosk_units
set
  fiscal_ambiente = 'PRODUCAO',
  fiscal_enabled = true,
  nfce_csc_id = '000002',
  nfce_serie = coalesce(nfce_serie, 1),
  nfce_qrcode_url_consulta = coalesce(nullif(nfce_qrcode_url_consulta, ''), 'http://www.sefa.pa.gov.br/nfce/consulta')
where name ilike '%Parque Shopping%' or name ilike '%Circuito%' or name ilike '%Playground%';
