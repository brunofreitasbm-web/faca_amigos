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
--    humana (boneco). Confirmado por nome:
--      9503.00.99: Balão Bichinhos, Balão brilhante, Balão Patrulha
--        canina, Massinha E.V.A., Mini Pop-it (exemplos textuais do
--        e-mail) + Helicóptero (não é boneco nem carrinho-com-boneco,
--        cai no "outros que não se encaixem").
--      9503.00.22: só "Carrinho Viatura polícia" fica aqui — o nome bate
--        com o exemplo do contador ("viatura de polícia com boneco").
--    "Miniatura carrinho" e "Miniatura Carrinho Pick Up" ficam em
--    9503.00.99 por ora: o nome não indica boneco junto, mas isso é uma
--    suposição sobre o produto físico, não confirmação do contador —
--    revisar se algum desses vier efetivamente com um boneco.
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

-- 3. Brinquedos com boneco (viatura de polícia) — NCM 9503.00.22.
update fa_kiosk_products
   set ncm = '95030022',
       pis_cst = '01',
       cofins_cst = '01'
 where btrim(name) ilike 'Carrinho Viatura polícia';

-- Demais brinquedos (sem boneco) — mantém 9503.00.99, só corrige o CST.
update fa_kiosk_products
   set pis_cst = '01',
       cofins_cst = '01'
 where btrim(name) ilike any (array[
   'Balão Bichinhos',
   'Balão brilhante',
   'Balão Patrulha canina',
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
