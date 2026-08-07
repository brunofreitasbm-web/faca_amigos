-- Fase 1 do plano fiscal: dados do EMITENTE da NFC-e.
--
-- Escopo desta leva de migrations (28-33): emissão de NFC-e (modelo 65,
-- mercadoria, ICMS, SEFA/PA) para as vendas de PRODUTO no PDV. A NFS-e das
-- sessões de brincar (serviço, ISS, Prefeitura de Belém) está fora de escopo
-- por decisão do dono — por isso `fa_checkout` não é tocada em lugar nenhum.
--
-- O Pará NÃO autoriza NFC-e em ambiente próprio: desde 02/09/2019 os
-- webservices da SEFA-PA foram desativados e a autorização passou para a
-- SVRS (Sefaz Virtual do Rio Grande do Sul). O que continua sendo estadual
-- é a Inscrição Estadual, o credenciamento do emissor, e o CSC.
--
-- SEGREDO: guardamos aqui apenas o `nfce_csc_id` (o identificador do CSC,
-- ex. '000001'), que não é secreto. O TOKEN do CSC e o certificado A1 (.pfx)
-- vivem exclusivamente no cofre local do PC do balcão — nunca no Supabase,
-- nunca no repositório. Ver apps/kiosk/src/fiscal/vault.ts.

alter table fa_kiosk_units add column if not exists cnpj text;
alter table fa_kiosk_units add column if not exists razao_social text;
alter table fa_kiosk_units add column if not exists nome_fantasia text;
alter table fa_kiosk_units add column if not exists inscricao_estadual text;
alter table fa_kiosk_units add column if not exists cnae_principal text;

-- CRT = Código de Regime Tributário. 1 = Simples Nacional, que é o caso do
-- FaçaAmigos. Numérico porque é assim que vai no XML.
alter table fa_kiosk_units add column if not exists crt smallint default 1;

alter table fa_kiosk_units add column if not exists end_logradouro text;
alter table fa_kiosk_units add column if not exists end_numero text;
alter table fa_kiosk_units add column if not exists end_complemento text;
alter table fa_kiosk_units add column if not exists end_bairro text;
alter table fa_kiosk_units add column if not exists end_municipio_ibge text default '1501402';
alter table fa_kiosk_units add column if not exists end_uf text default 'PA';
alter table fa_kiosk_units add column if not exists end_cep text;
alter table fa_kiosk_units add column if not exists fone text;

alter table fa_kiosk_units add column if not exists fiscal_ambiente text default 'HOMOLOGACAO';
alter table fa_kiosk_units drop constraint if exists fa_kiosk_units_fiscal_ambiente_check;
alter table fa_kiosk_units add constraint fa_kiosk_units_fiscal_ambiente_check
  check (fiscal_ambiente in ('HOMOLOGACAO', 'PRODUCAO'));

-- Kill switch mestre. `false` por padrão permite subir TODO o código fiscal
-- em produção sem emitir nada — cada fase do plano é verificável sem risco.
-- Ligar só depois da homologação ter rodado uma semana inteira.
alter table fa_kiosk_units add column if not exists fiscal_enabled boolean not null default false;

alter table fa_kiosk_units add column if not exists nfce_serie integer default 1;
alter table fa_kiosk_units add column if not exists nfce_csc_id text;
alter table fa_kiosk_units add column if not exists nfce_qrcode_url_consulta text;
