-- Identidade DESTE computador (device_id e a unidade a que o terminal
-- pertence). Tabela própria, sem FK e sem escopo por unidade, de
-- propósito: a tentativa anterior gravava isso em app_settings com
-- unit_id = 'global', mas app_settings tem
-- `unit_id TEXT NOT NULL REFERENCES units (id)` e a conexão liga
-- `PRAGMA foreign_keys = ON` — e a tabela `units` local fica VAZIA em
-- produção (seedDevData só roda com FACAAMIGOS_SEED_DEV=true). Todo
-- INSERT falhava com FOREIGN KEY constraint failed, a rota devolvia 500
-- e o front engolia o erro, então o terminal nunca soube a sua unidade e
-- o print bridge passou a imprimir job de TODAS as unidades.
--
-- Identidade de terminal não é dado por unidade: é justamente o que
-- diz a qual unidade o terminal pertence. Por isso a chave é só `key`.

CREATE TABLE IF NOT EXISTS terminal_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
