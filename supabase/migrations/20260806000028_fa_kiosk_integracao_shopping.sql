-- Espelho em nuvem da migration local 0005_integracao_shopping.sql
-- (packages/db-local/src/migrations). Integração de faturamento com a
-- administração do shopping: identificação fiscal/contratual da
-- unidade, chaves de acesso emitidas para terceiros e trilha de uso.
--
-- O endpoint que o shopping consome hoje é servido pelo kiosk local
-- (apps/kiosk/src/server/routes/faturamento.ts). Estas tabelas existem
-- na nuvem para que o back-office administre a integração pelo mesmo
-- lugar que administra o resto — e para que a declaração continue
-- consultável com o PC da loja desligado, quando o sync da Fase 2
-- estiver de pé.

alter table fa_kiosk_units add column if not exists cnpj text;
alter table fa_kiosk_units add column if not exists razao_social text;
-- LUC: código da unidade comercial no contrato de locação.
alter table fa_kiosk_units add column if not exists shopping_luc text;
alter table fa_kiosk_units add column if not exists shopping_store_code text;

-- Só o hash do segredo é gravado (scrypt, mesmo esquema do PIN).
-- `prefix` é a parte pública, usada para localizar a linha e para o
-- humano reconhecer a chave no painel.
create table if not exists fa_kiosk_integration_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null unique,
  key_hash text not null,
  scope text not null check (scope in ('FATURAMENTO_LEITURA')),
  unit_id uuid references fa_kiosk_units (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by_employee_id uuid references fa_kiosk_employees (id),
  last_used_at_ms bigint,
  revoked_at_ms bigint
);

create table if not exists fa_kiosk_integration_access_log (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references fa_kiosk_integration_api_keys (id),
  at_ms bigint not null,
  route text not null,
  query text,
  status integer not null,
  remote_ip text
);
create index if not exists idx_fa_kiosk_integration_access_log_at on fa_kiosk_integration_access_log (at_ms desc);
create index if not exists idx_fa_kiosk_integration_access_log_key on fa_kiosk_integration_access_log (api_key_id);

-- RLS: credencial de terceiro é assunto de ADMIN, mais restrito que o
-- GERENTE que administra o catálogo. `anon` não enxerga nada — nem o
-- hash, nem o prefixo, nem o log.
alter table fa_kiosk_integration_api_keys enable row level security;
drop policy if exists fa_kiosk_integration_keys_admin on fa_kiosk_integration_api_keys;
create policy fa_kiosk_integration_keys_admin on fa_kiosk_integration_api_keys
  for all to authenticated
  using (fa_kiosk_has_role('ADMIN'))
  with check (fa_kiosk_has_role('ADMIN'));

alter table fa_kiosk_integration_access_log enable row level security;
-- Log é leitura para gestão e escrita pelo servidor: quem opera
-- precisa poder investigar "o shopping consultou?" sem poder reescrever
-- a resposta.
drop policy if exists fa_kiosk_integration_log_read_manager on fa_kiosk_integration_access_log;
create policy fa_kiosk_integration_log_read_manager on fa_kiosk_integration_access_log
  for select to authenticated
  using (fa_kiosk_has_role('GERENTE'));

revoke all on fa_kiosk_integration_api_keys from anon;
revoke all on fa_kiosk_integration_access_log from anon;
