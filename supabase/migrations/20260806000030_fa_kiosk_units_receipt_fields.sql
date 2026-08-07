-- Dados da unidade para compor o cabeçalho do cupom não fiscal (endereço,
-- telefone, CNPJ), editáveis pelo backoffice em Configurações > unidade.
-- fa_kiosk_units já tem RLS de leitura authenticated / escrita GERENTE+
-- (migration 009) — colunas novas herdam as mesmas policies da tabela.
alter table fa_kiosk_units
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists cnpj text;
