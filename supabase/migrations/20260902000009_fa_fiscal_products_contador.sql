-- =====================================================================
-- Tributação dos produtos conforme retorno do contador (NFC-e).
--
-- Substitui os chutes por `ilike '%Água%'` da migration 20260819000001 por
-- atualização produto a produto, pelo nome exato cadastrado (15 produtos
-- ativos hoje). `btrim(name) ilike` porque há nome com espaço no fim
-- ("Meia Antiderrapante ") e variação de caixa ("Água mineral"/"Água
-- Mineral") — mesmo produto, mesma tributação.
--
-- Comum a todos (Simples Nacional, mercadoria nacional, venda no estado):
--   CSOSN 102, CFOP 5102, origem 0, unidade UN, sem GTIN.
--   PIS/COFINS CST 04 (monofásico/alíquota zero) — orientação do contador,
--   substitui o 49 genérico da migration 20260806000030.
--
-- PENDENTE COM O CONTADOR (não tocar aqui até resposta):
--   - CEST da água mineral: mantido o que já está gravado (0300500 da
--     migration 20260819000001), a confirmar.
--   - NCM das pilhas: fica NULL de propósito — fiscal_ready continua false
--     e o worker segue marcando BLOQUEADO até o contador informar.
-- =====================================================================

-- Água mineral — NCM 2201.10.00 (água mineral natural). CEST não é tocado.
update fa_kiosk_products
   set ncm = '22011000',
       csosn = '102',
       cfop = '5102',
       origem = 0,
       pis_cst = '04',
       cofins_cst = '04',
       unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
       gtin = coalesce(nullif(gtin, ''), 'SEM GTIN')
 where btrim(name) ilike any (array['Água mineral', 'Água Mineral']);

-- Suco de fruta — NCM 2009.89.00 (sucos de outras frutas).
update fa_kiosk_products
   set ncm = '20098900',
       csosn = '102',
       cfop = '5102',
       origem = 0,
       pis_cst = '04',
       cofins_cst = '04',
       unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
       gtin = coalesce(nullif(gtin, ''), 'SEM GTIN')
 where btrim(name) ilike 'Suco de Fruta';

-- Meia antiderrapante — NCM 6115.95.00 (meias de algodão).
update fa_kiosk_products
   set ncm = '61159500',
       csosn = '102',
       cfop = '5102',
       origem = 0,
       pis_cst = '04',
       cofins_cst = '04',
       unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
       gtin = coalesce(nullif(gtin, ''), 'SEM GTIN')
 where btrim(name) ilike any (array['Meia antiderrapante', 'Meia Antiderrapante']);

-- Brinquedos e miniaturas — NCM 9503.00.99 (outros brinquedos).
update fa_kiosk_products
   set ncm = '95030099',
       csosn = '102',
       cfop = '5102',
       origem = 0,
       pis_cst = '04',
       cofins_cst = '04',
       unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
       gtin = coalesce(nullif(gtin, ''), 'SEM GTIN')
 where btrim(name) ilike any (array[
   'Balão Bichinhos',
   'Balão brilhante',
   'Balão Patrulha canina',
   'Carrinho Viatura polícia',
   'Helicóptero',
   'Massinha E.V.A',
   'Mini Popt',
   'Miniatura carrinho',
   'Miniatura Carrinho Pick Up'
 ]);

-- Pilhas — NCM aguardando o contador; só os campos comuns.
update fa_kiosk_products
   set csosn = '102',
       cfop = '5102',
       origem = 0,
       pis_cst = '04',
       cofins_cst = '04',
       unidade_comercial = coalesce(nullif(unidade_comercial, ''), 'UN'),
       gtin = coalesce(nullif(gtin, ''), 'SEM GTIN')
 where btrim(name) ilike 'Pilhas';
