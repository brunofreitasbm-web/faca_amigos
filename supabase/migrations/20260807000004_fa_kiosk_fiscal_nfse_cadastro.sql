-- Cadastro de NFS-e (nota de SERVIÇO — as sessões de brincar, ISS,
-- Prefeitura de Belém). Só o CADASTRO: a emissão continua fora de escopo,
-- exatamente como declarado na migration 20260806000029. fa_checkout segue
-- intocada, e nenhuma fila é criada aqui.
--
-- Por que os campos existem antes da emissão: a tela Configurações >
-- Fiscal precisa reunir num lugar só o que o contador pede, e esses dados
-- (inscrição municipal, item da lista de serviço, alíquota de ISS) são
-- levantados uma vez e mudam raramente. Deixá-los cadastrados e conferidos
-- é o pré-requisito da emissão, não parte dela.
--
-- SEGREDO: nada de token aqui, mesma regra da NFC-e. O certificado A1
-- (.pfx) e as credenciais do webservice municipal vivem só no cofre local
-- do PC do balcão — nunca no Supabase, nunca no repositório.

alter table fa_kiosk_units add column if not exists inscricao_municipal text;

-- Item da lista de serviços da LC 116/2003. Playground/recreação infantil
-- cai em 12.xx (diversão, lazer, entretenimento) — o número exato é o
-- contador que confirma, por isso é texto livre e não um check.
alter table fa_kiosk_units add column if not exists nfse_item_lista_servico text;

-- Código de tributação do município (CTISS/tabela própria de Belém), que
-- não coincide com o item da LC 116.
alter table fa_kiosk_units add column if not exists nfse_codigo_tributacao_municipio text;

-- Alíquota de ISS em pontos-base (250 = 2,50%). Inteiro pelo mesmo motivo
-- que todo dinheiro no schema é em centavos: ponto flutuante em cálculo
-- tributário produz divergência de centavo que vira pendência fiscal.
alter table fa_kiosk_units add column if not exists nfse_aliquota_iss_bp integer default 0;

alter table fa_kiosk_units add column if not exists nfse_iss_retido boolean not null default false;

-- Regime especial de tributação. 6 = Microempresário e Empresa de Pequeno
-- Porte (Simples Nacional), coerente com o crt = 1 da NFC-e.
alter table fa_kiosk_units add column if not exists nfse_regime_especial smallint default 6;

alter table fa_kiosk_units add column if not exists nfse_serie_rps text default '1';
alter table fa_kiosk_units add column if not exists nfse_ambiente text default 'HOMOLOGACAO';
alter table fa_kiosk_units drop constraint if exists fa_kiosk_units_nfse_ambiente_check;
alter table fa_kiosk_units add constraint fa_kiosk_units_nfse_ambiente_check
  check (nfse_ambiente in ('HOMOLOGACAO', 'PRODUCAO'));

-- Mesmo kill switch da NFC-e, e pelo mesmo motivo: permite cadastrar e
-- conferir tudo em produção sem emitir nada. Enquanto a emissão de NFS-e
-- não existir, este campo é só declaração de intenção — a UI deixa isso
-- explícito em vez de sugerir que ligar o botão emite alguma coisa.
alter table fa_kiosk_units add column if not exists nfse_enabled boolean not null default false;
