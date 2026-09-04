-- Fase 2 da Bonificação (docs/bonificacao/programa-bonificacao-set-2026.md):
-- "cadastrar custo dos produtos" — os R$ 2/R$ 4 por item do bônus de vendas
-- do Circuito foram calibrados chutando custo de R$ 15-18 pra uma miniatura
-- de R$ 32,90, sem dado real. Coluna opcional (null = não cadastrado ainda,
-- não é obrigatório preencher pra vender o produto), só o Owner edita —
-- mesma capacidade de fa_kiosk_products (config.write), sem policy nova.

alter table fa_kiosk_products
  add column if not exists cost_cents integer check (cost_cents is null or cost_cents >= 0);

comment on column fa_kiosk_products.cost_cents is
  'Custo de aquisição do produto, em centavos. Null = não cadastrado. Usado só para exibir margem em Gerencial → Produtos; não entra em nenhum cálculo de venda/estoque.';
