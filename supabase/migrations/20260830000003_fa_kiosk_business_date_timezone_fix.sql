-- Bug: "Relatórios Gerais > Vendas" mostrava "Ontem" incompleto/errado e
-- "Hoje" completamente vazio (Vazio), mesmo com pedidos pagos no banco.
--
-- Causa raiz: fa_kiosk_business_date(p_now_ms, p_cutoff_hour) fazia
--   (to_timestamp(...))::date
-- e essa conversão timestamptz -> date usa o timezone da SESSÃO do banco,
-- que no Supabase é UTC por padrão -- não o timezone da unidade
-- (fa_kiosk_units.timezone = 'America/Belem', UTC-3, coluna existente mas
-- nunca lida por esta função). O corte virava então às 04:00 UTC = 01:00
-- em Belém, enquanto o front-end (RelatorioScreen.tsx `isoDate`) calcula
-- "Hoje"/"Ontem" com `Date#toISOString().slice(0,10)`, ou seja, data
-- corrida em UTC (corte às 00:00 UTC = 21:00 em Belém). Os dois pontos de
-- corte ficam ~3-4h fora de sincronia, então pedidos pagos entre ~21h e
-- ~01h (horário nobre de um playground) caem num business_date que não
-- bate com o intervalo `from`/`to` que a tela está consultando.
--
-- Fix: aplicar o timezone da unidade (America/Belem é fixo e sem horário
-- de verão desde a extinção do DST no Brasil em 2019) antes do corte, para
-- que o "dia" ande no relógio local e não no relógio UTC do servidor.
-- Mesma assinatura (2 argumentos) -- create or replace substitui a função
-- para todos os ~20 callers (checkin/checkout/turnos/relatórios) sem
-- precisar tocar em cada um.
create or replace function fa_kiosk_business_date(p_now_ms bigint, p_cutoff_hour integer) returns date as $$
  select ((to_timestamp(p_now_ms / 1000.0) at time zone 'America/Belem') - (p_cutoff_hour || ' hours')::interval)::date
$$ language sql immutable;
