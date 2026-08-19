-- Corrige drift de schema: produção tem fa_kiosk_orders.created_at
-- (timestamptz), coluna usada pelo client (Api.shiftSales, ver
-- api/client.ts) e por nenhuma migration versionada até aqui — foi
-- adicionada direto no banco de produção em algum momento, fora do fluxo
-- de migrations. Confirmado ao aplicar as migrations do zero num branch de
-- teste: a tela "Vendas do turno" do Caixa quebrava com 42703 (column
-- fa_kiosk_orders.created_at does not exist), porque só existe
-- `created_at_ms` (fa_kiosk_orders é a tabela-stub original, ver comentário
-- em api/client.ts linha ~1862).
--
-- `if not exists` + default: em produção vira no-op (a coluna já existe);
-- num ambiente novo, deixa o schema batendo com o que o client espera.
alter table fa_kiosk_orders
  add column if not exists created_at timestamptz not null default now();
