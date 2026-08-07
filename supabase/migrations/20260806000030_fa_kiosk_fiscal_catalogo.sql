-- Fase 1 do plano fiscal: tributação dos PRODUTOS.
--
-- Sem estes campos a SEFAZ rejeita a nota — tributação errada é a causa nº 1
-- de rejeição de NFC-e. Os defaults abaixo são o caso comum de um varejo do
-- Simples Nacional vendendo mercadoria nacional dentro do próprio estado, mas
-- são SUGESTÕES: cada valor precisa ser confirmado pelo contador (Fase 0.A do
-- plano) antes de emitir qualquer coisa em produção.
--
--   CFOP 5102 — venda de mercadoria adquirida de terceiros, dentro do estado
--   CSOSN 102 — Simples Nacional, tributada sem permissão de crédito
--   origem 0   — nacional
--   PIS/COFINS CST 49 — outras operações (usual no Simples)
--
-- `fa_kiosk_plans` NÃO ganha campos aqui: sessão é serviço (NFS-e), fora do
-- escopo desta entrega.

alter table fa_kiosk_products add column if not exists ncm text;
alter table fa_kiosk_products add column if not exists cest text;
alter table fa_kiosk_products add column if not exists cfop text default '5102';
alter table fa_kiosk_products add column if not exists unidade_comercial text default 'UN';
alter table fa_kiosk_products add column if not exists origem smallint default 0;
alter table fa_kiosk_products add column if not exists csosn text default '102';
alter table fa_kiosk_products add column if not exists gtin text default 'SEM GTIN';
alter table fa_kiosk_products add column if not exists pis_cst text default '49';
alter table fa_kiosk_products add column if not exists cofins_cst text default '49';

-- Coluna gerada: o backoffice pinta de vermelho o que ainda não pode ser
-- vendido com nota, e o worker recusa o documento (status BLOQUEADO) antes de
-- gastar uma chamada à SEFAZ. NCM é o único campo sem default possível —
-- depende do produto e só o contador sabe.
alter table fa_kiosk_products add column if not exists fiscal_ready boolean
  generated always as (
    ncm is not null and length(ncm) = 8
    and cfop is not null
    and csosn is not null
    and origem is not null
    and unidade_comercial is not null
  ) stored;
