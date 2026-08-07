-- Integração de faturamento com a administração do shopping.
--
-- Todo contrato de locação em shopping obriga o lojista a declarar o
-- faturamento periodicamente (base do aluguel percentual, do fundo de
-- promoção e do rateio de condomínio). A administração costuma pedir
-- isso por um dos três caminhos: portal manual, arquivo em layout
-- fixo, ou uma API que ela mesma consulta. Aqui preparamos o caminho
-- mais trabalhoso dos três (API consultável) — os outros dois saem do
-- mesmo agregado, só mudando a serialização.
--
-- Nada aqui recalcula venda: o agregado lê `orders`/`order_items`/
-- `payments` já fechados pelo caixa. Se o número divergir do relatório
-- interno, é bug — não é "outra visão".

-- Identificação fiscal e contratual da unidade. O shopping identifica
-- a loja pela LUC (Loja de Unidade Comercial, o "endereço" contratual
-- dentro do empreendimento) e/ou por um código de lojista próprio do
-- sistema dele; o CNPJ é o que amarra ao contrato e à nota fiscal.
ALTER TABLE units ADD COLUMN cnpj TEXT;
ALTER TABLE units ADD COLUMN razao_social TEXT;
ALTER TABLE units ADD COLUMN shopping_luc TEXT;
ALTER TABLE units ADD COLUMN shopping_store_code TEXT;

-- Chaves de acesso entregues a terceiros (hoje: a administração do
-- shopping). O segredo completo NUNCA é gravado — só o prefixo
-- público (para localizar a linha e para o humano reconhecer a chave
-- no painel) e o hash scrypt do segredo, igual ao PIN do funcionário.
-- Revogar é escrever `revoked_at_ms`, não apagar a linha: o histórico
-- de acesso precisa continuar apontando para uma chave existente.
CREATE TABLE integration_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('FATURAMENTO_LEITURA')),
  unit_id TEXT REFERENCES units (id),
  created_at_ms INTEGER NOT NULL,
  created_by_employee_id TEXT REFERENCES employees (id),
  last_used_at_ms INTEGER,
  revoked_at_ms INTEGER
);

-- Trilha de acesso: quem consultou, quando, qual período pediu e o que
-- recebeu de volta. Serve para duas conversas previsíveis com a
-- administração — "vocês não enviaram" (temos o log) e "esse número
-- mudou depois" (temos a data da consulta e o período consultado).
CREATE TABLE integration_access_log (
  id TEXT PRIMARY KEY,
  api_key_id TEXT REFERENCES integration_api_keys (id),
  at_ms INTEGER NOT NULL,
  route TEXT NOT NULL,
  query TEXT,
  status INTEGER NOT NULL,
  remote_ip TEXT
);
CREATE INDEX idx_integration_access_log_at ON integration_access_log (at_ms);
CREATE INDEX idx_integration_access_log_key ON integration_access_log (api_key_id);
