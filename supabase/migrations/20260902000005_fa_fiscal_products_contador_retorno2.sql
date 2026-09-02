-- =====================================================================
-- Segundo retorno do contador (2026-09-02): CEST/CSOSN da água, split de
-- NCM dos brinquedos, NCM das pilhas e correção do CST de PIS/COFINS.
--
-- 1. Água mineral: CEST correto é 0300500 (03.005.00), não 0300504 (o
--    valor que estava gravado desde a migration 20260819000001 estava
--    errado). Por ter substituição tributária, o CSOSN de revenda é 500
--    ("ICMS cobrado anteriormente por ST"), não 102 — packages/fiscal
--    ganhou o grupo ICMSSN500 nesta mesma entrega (nfce-xml.ts).
--
-- 2. PIS/COFINS: o contador confirmou que CST 04 (monofásico) só vale
--    para água e suco. Meias, brinquedos, pilhas e salgadinho usam CST 01
--    (tributado pela alíquota normal do Simples) — resposta com "geralmente",
--    não 100% fechada; se ele mandar um CST mais específico depois, ajustar
--    aqui de novo.
--
-- 3. Brinquedos — NCM 9503.00.99 (outros brinquedos) x 9503.00.22 (outros
--    bonecos, mesmo vestidos). Critério do contador: presença de figura
--    humana (boneco). Perguntado direto ao dono da loja sobre cada item
--    ambíguo: nenhum dos carrinhos/viaturas vendidos vem com bonequinho
--    (confirmado 2026-09-02) — logo NINGUÉM cai em 9503.00.22 hoje; todos
--    os brinquedos ficam em 9503.00.99, só corrigindo o CST abaixo.
--
-- 4. Pilhas comuns (zinco-carbono): NCM 8506.80.10.
-- =====================================================================

-- 1. Água mineral — CEST correto e CSOSN de substituição tributária.
update fa_kiosk_products
   set cest = '0300500',
       csosn = '500',
       pis_cst = '04',
       cofins_cst = '04'
 where btrim(name) ilike any (array['Água mineral', 'Água Mineral']);

-- 2. Salgadinho e meia — CST 04 não se aplica, vai para 01. Suco mantém
-- CST 04 (confirmado pelo contador) — sem update para ele aqui.
update fa_kiosk_products
   set pis_cst = '01',
       cofins_cst = '01'
 where btrim(name) ilike 'Salgadinho'
    or btrim(name) ilike any (array['Meia antiderrapante', 'Meia Antiderrapante']);

-- 3. Brinquedos — nenhum vem com boneco, todos ficam em 9503.00.99
-- (já gravado desde a migration 20260819000001), só corrige o CST.
update fa_kiosk_products
   set pis_cst = '01',
       cofins_cst = '01'
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

-- 4. Pilhas — NCM confirmado.
update fa_kiosk_products
   set ncm = '85068010',
       pis_cst = '01',
       cofins_cst = '01'
 where btrim(name) ilike 'Pilhas';
