-- Torna configurável o horário de abertura que a trava de abertura da
-- bonificação usa. Antes, o limite era fixo no código
-- (apps/kiosk-ui/src/lib/apuracaoBonificacao.ts `getAberturaLimiteMin` e
-- docs/bonificacao/apuracao_bonificacao.sql): 10:15 de seg-sáb, 12:15 no
-- domingo. Quando o shopping muda o horário (12/10/2026: 11h-21h), quem abriu
-- o caixa dentro dos 15 min de tolerância do horário real perdia o bônus do dia.
--
-- Duas tabelas, ambas guardam o HORÁRIO DE ABERTURA (minutos desde 00:00); o
-- limite da trava é abertura + 15 min de tolerância (constante no código):
--   1. fa_kiosk_unit_opening_hours — padrão por unidade e dia da semana
--      (weekday 1-7, isodow). Editável em Gerencial > Metas.
--   2. fa_kiosk_unit_opening_overrides — exceção para uma data específica de
--      uma unidade (feriado, evento, horário especial do shopping). Vence o padrão.
-- Sem linha em nenhuma das duas: vale o comportamento antigo (10:00 seg-sáb,
-- 12:00 domingo), então nada muda para quem não configurar.

create table if not exists fa_kiosk_unit_opening_hours (
  unit_id uuid not null references fa_kiosk_units (id),
  weekday smallint not null check (weekday between 1 and 7), -- isodow: 1=segunda ... 7=domingo
  abertura_min smallint not null check (abertura_min between 0 and 1439),
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, weekday)
);

alter table fa_kiosk_unit_opening_hours enable row level security;

create policy fa_kiosk_unit_opening_hours_read on fa_kiosk_unit_opening_hours
  for select to authenticated using (true);

create policy fa_kiosk_unit_opening_hours_write on fa_kiosk_unit_opening_hours
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));

create table if not exists fa_kiosk_unit_opening_overrides (
  unit_id uuid not null references fa_kiosk_units (id),
  business_date date not null,
  abertura_min smallint not null check (abertura_min between 0 and 1439),
  motivo text,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, business_date)
);

alter table fa_kiosk_unit_opening_overrides enable row level security;

create policy fa_kiosk_unit_opening_overrides_read on fa_kiosk_unit_opening_overrides
  for select to authenticated using (true);

create policy fa_kiosk_unit_opening_overrides_write on fa_kiosk_unit_opening_overrides
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));

-- Exceção de 12/10/2026 (segunda): shoppings abriram às 11h. Limite resultante: 11:15.
insert into fa_kiosk_unit_opening_overrides (unit_id, business_date, abertura_min, motivo)
select id, date '2026-10-12', 11 * 60, 'Shopping abriu às 11h (horário 11h-21h)'
from fa_kiosk_units
on conflict (unit_id, business_date) do update set
  abertura_min = excluded.abertura_min,
  motivo = excluded.motivo,
  updated_at_ms = (extract(epoch from now()) * 1000)::bigint;
