-- =====================================================================
-- Certificado A1 para transmissão de NFS-e — upload pela tela Gerencial.
--
-- O padrão já estabelecido no fiscal (ver migration 20260806000032) é
-- "nada de certificado no Supabase, só no PC do balcão". Optamos por
-- abrir exceção aqui a pedido explícito do usuário (upload pelo Gerencial
-- em vez do app do kiosk), mitigando o risco: a senha nunca fica em texto
-- puro em lugar nenhum (só cifrada, com a chave só na Edge Function), o
-- arquivo .pfx fica num bucket privado sem NENHUMA policy de leitura pro
-- cliente (só service_role, via Edge Function, passa por cima do RLS), e
-- a tabela é legível só por ADMIN (Owner) — nem GERENTE.
--
-- O upload e a decifragem são feitos por Edge Functions dedicadas
-- (nfse-certificate-upload / futura nfse-certificate-fetch), nunca por
-- escrita direta do client — daí zero policies de insert/update aqui.
create table if not exists fa_kiosk_fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  storage_path text not null,
  encrypted_password text not null,
  subject_cn text,
  issuer_cn text,
  expires_at_ms bigint,
  uploaded_by_employee_id uuid references fa_kiosk_employees (id),
  uploaded_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  replaced_at_ms bigint
);

create unique index if not exists idx_fa_kiosk_fiscal_certificates_unit_active
  on fa_kiosk_fiscal_certificates (unit_id) where replaced_at_ms is null;

alter table fa_kiosk_fiscal_certificates enable row level security;

-- Leitura restrita a Owner, e mesmo assim sem a senha cifrada (o Gerencial
-- só precisa mostrar "certificado configurado em DD/MM, válido até X").
drop policy if exists fa_kiosk_fiscal_certificates_read on fa_kiosk_fiscal_certificates;
create policy fa_kiosk_fiscal_certificates_read on fa_kiosk_fiscal_certificates
  for select to authenticated using (fa_kiosk_can('config.fiscal.write'));

-- fa_kiosk_fiscal_certificate_status: view sem a senha cifrada nem o
-- storage_path, pro Gerencial nunca precisar de um SELECT * aqui.
create or replace view fa_kiosk_fiscal_certificate_status as
  select unit_id, subject_cn, issuer_cn, expires_at_ms, uploaded_at_ms
    from fa_kiosk_fiscal_certificates
    where replaced_at_ms is null;

grant select on fa_kiosk_fiscal_certificate_status to authenticated;

-- Bucket privado — zero policies de storage.objects de propósito. Só
-- service_role (Edge Function) toca esses arquivos.
insert into storage.buckets (id, name, public)
values ('fiscal-certificados', 'fiscal-certificados', false)
on conflict (id) do nothing;
