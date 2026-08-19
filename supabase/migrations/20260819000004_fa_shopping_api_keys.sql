-- Corrige vulnerabilidade crítica na API de faturamento do shopping
-- (/integracao/shopping/v1/*): authenticateShoppingRequest() em
-- apps/kiosk-ui/api/_shopping/common.ts nunca validava o segredo da chave,
-- apenas checava se o token continha "playground"/"circuito" ou começava
-- com "fa_shp_" — qualquer string nesse formato (mesmo com segredo trocado)
-- era aceita e retornava dados reais de faturamento. Reportado pelo
-- shopping em homologação (fichatecnicaapi.md).
--
-- Cria tabela de chaves com hash (nunca texto puro) e semeia as duas
-- chaves de homologação já entregues ao shopping (ver
-- apps/kiosk-ui/src/screens/SecretVaultReader.tsx), vinculando cada uma à
-- unidade correta do Parque Shopping — a lógica antiga de "primeira
-- unidade não-circuito" pegava por acaso a unidade errada
-- (Bosque Grão-Pará, sem nenhum pedido), o que também explicava os
-- "dias": [] reportados pelo shopping.

create table if not exists fa_shopping_api_keys (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units(id),
  key_hash text not null unique,
  label text not null,
  scope text not null default 'FATURAMENTO_LEITURA',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_fa_shopping_api_keys_unit on fa_shopping_api_keys (unit_id);

alter table fa_shopping_api_keys enable row level security;
-- Somente a service role (usada pelas rotas /api/integracao/shopping) acessa esta tabela.

insert into fa_shopping_api_keys (unit_id, key_hash, label)
values
  (
    '11111111-1111-1111-1111-111111111111',
    encode(extensions.digest('fa_shp_playground_homolog_99a8b7c6d5', 'sha256'), 'hex'),
    'Playground (Parque Shopping) — homologação'
  ),
  (
    'e43ba7a8-bd5f-47ad-b81d-dae7ea19d504',
    encode(extensions.digest('fa_shp_circuito_homolog_11e2f3g4h5', 'sha256'), 'hex'),
    'Parque Circuito — homologação'
  )
on conflict (key_hash) do nothing;
