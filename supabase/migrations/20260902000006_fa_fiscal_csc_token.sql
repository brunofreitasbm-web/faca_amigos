-- =====================================================================
-- Token do CSC da NFC-e — cadastro pela tela Gerencial, cifrado.
--
-- Até aqui a regra (migration 20260806000035) era "o TOKEN do CSC vive só
-- no cofre local do PC do balcão, nunca no Supabase". Com o certificado A1
-- já sendo servido pela nuvem (migration 20260819000002 +
-- nfse-certificate-fetch), manter o token só no disco deixava o segundo
-- terminal/failover sem conseguir emitir NFC-e. Abrimos a mesma exceção,
-- com a mesma mitigação: o token nunca fica em texto puro (AES-GCM com a
-- chave só na Edge Function, ver supabase/functions/_shared/fiscalCrypto.ts),
-- a tabela NÃO tem policy nenhuma (RLS ligado, zero policies — nem Owner lê
-- pelo client), e só duas Edge Functions encostam nela via service_role:
-- fiscal-csc-upload (escreve) e nfse-certificate-fetch (lê, só pro worker).
--
-- O `id` do CSC continua em fa_kiosk_units.nfce_csc_id — não é segredo e
-- fa_fiscal_claim_next já o entrega ao worker.
-- =====================================================================
create table if not exists fa_kiosk_fiscal_unit_secrets (
  unit_id uuid primary key references fa_kiosk_units (id) on delete cascade,
  nfce_csc_token_encrypted text not null,
  updated_by_employee_id uuid references fa_kiosk_employees (id),
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_kiosk_fiscal_unit_secrets enable row level security;
-- Zero policies de propósito: só service_role (Edge Functions) lê/escreve.
-- Cinto e suspensório — RLS sem policy já nega tudo, mas o revoke deixa a
-- intenção explícita no catálogo.
revoke all on fa_kiosk_fiscal_unit_secrets from anon, authenticated;

-- fa_kiosk_fiscal_csc_status: o Gerencial só precisa saber "CSC configurado
-- em DD/MM" — nunca o token. Mesmo desenho de
-- fa_kiosk_fiscal_certificate_status (migration 20260819000002); a view roda
-- como o dono e por isso passa por cima do RLS da tabela sem expor o
-- conteúdo cifrado. `anon` entra porque o Painel do kiosk-ui ainda pode
-- rodar sem sessão (mesma razão de fa_kiosk_fiscal_terminal_status_read_anon).
create or replace view fa_kiosk_fiscal_csc_status as
  select unit_id, updated_at_ms
    from fa_kiosk_fiscal_unit_secrets;

grant select on fa_kiosk_fiscal_csc_status to authenticated, anon;
