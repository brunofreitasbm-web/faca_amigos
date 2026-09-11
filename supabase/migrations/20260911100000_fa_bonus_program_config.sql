-- Torna configurável, por unidade, o que hoje está hardcoded em
-- apps/kiosk-ui/src/lib/apuracaoBonificacao.ts e apps/kiosk-ui/src/bonificacao.ts
-- (as tabelas de meta/supermeta do piloto Playground+Circuito,
-- docs/bonificacao/programa-bonificacao-set-2026.md) e no script manual
-- docs/bonificacao/apuracao_bonificacao.sql. Antes desta migration, mudar
-- uma meta ou o teto do mês exigia editar código — o Owner não tinha
-- nenhum jeito de ajustar isso pelo Gerencial.
--
-- Duas tabelas, mesmo padrão de fa_kiosk_unit_daily_goals (20260904000001):
--   1. fa_kiosk_bonus_program_goals — meta/supermeta por dia da semana
--      (weekday 1-7, isodow), uma linha por unidade/dia. meta_valor/
--      super_valor são faturamento em centavos (unidades tipo LOJA,
--      "Playground") ou nº de locações (unidades tipo QUIOSQUE, "Circuito")
--      — a interpretação depende de fa_kiosk_units.kind, igual ao resto do
--      programa.
--   2. fa_kiosk_bonus_program_config — os valores que não variam por dia
--      da semana: teto mensal, faixa de preço e valor do bônus de produto,
--      meta/bônus de itens vendidos no mês, e os dois bônus extras que só
--      valem para um dos dois tipos de unidade (bônus de sessão de 1h+ no
--      Playground, bônus por locação acima da meta no Circuito).
--
-- Sem seed: fica vazio até o Owner configurar em Gerencial > Metas — uma
-- unidade sem linha aqui simplesmente não gera bônus (equivalente ao
-- "Não definida" do termômetro de meta diária), nunca um valor adivinhado.
-- A migration seguinte semeia as duas unidades do piloto com os valores
-- que já estavam em produção, para não interromper o piloto em andamento.

create table if not exists fa_kiosk_bonus_program_goals (
  unit_id uuid not null references fa_kiosk_units (id),
  weekday smallint not null check (weekday between 1 and 7), -- isodow: 1=segunda ... 7=domingo
  meta_valor integer not null default 0 check (meta_valor >= 0),
  super_valor integer not null default 0 check (super_valor >= 0),
  meta_bonus_cents integer not null default 0 check (meta_bonus_cents >= 0),
  super_bonus_cents integer not null default 0 check (super_bonus_cents >= 0),
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, weekday)
);

alter table fa_kiosk_bonus_program_goals enable row level security;

create policy fa_kiosk_bonus_program_goals_read on fa_kiosk_bonus_program_goals
  for select to authenticated using (true);

create policy fa_kiosk_bonus_program_goals_write on fa_kiosk_bonus_program_goals
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));

create table if not exists fa_kiosk_bonus_program_config (
  unit_id uuid primary key references fa_kiosk_units (id),
  -- Teto de bônus por operador no mês (metas + produtos), hoje R$200.
  -- Aplicado por unidade (mesmo padrão de fa_kiosk_unit_ticket_goals) — um
  -- operador que trabalha em duas unidades tem um teto em cada uma, não um
  -- teto único somado entre as duas.
  teto_mes_cents integer not null default 0 check (teto_mes_cents >= 0),
  -- Bônus por produto vendido: um valor abaixo do preço de corte, outro a
  -- partir dele (ex.: R$2 até R$39,99, R$4 a partir de R$49,90).
  produto_preco_corte_cents integer not null default 0 check (produto_preco_corte_cents >= 0),
  produto_bonus_baixo_cents integer not null default 0 check (produto_bonus_baixo_cents >= 0),
  produto_bonus_alto_cents integer not null default 0 check (produto_bonus_alto_cents >= 0),
  -- Bônus único ao bater N produtos vendidos no mês (hoje 10 itens = +R$10).
  itens_mes_meta integer not null default 0 check (itens_mes_meta >= 0),
  itens_mes_bonus_cents integer not null default 0 check (itens_mes_bonus_cents >= 0),
  -- Só Playground: +sessao_1h_bonus_cents no dia se a fração de sessões de
  -- 1h ou mais for >= sessao_1h_percentual_min (0-100). Deixe ambos 0 numa
  -- unidade Circuito.
  sessao_1h_percentual_min smallint not null default 0 check (sessao_1h_percentual_min between 0 and 100),
  sessao_1h_bonus_cents integer not null default 0 check (sessao_1h_bonus_cents >= 0),
  -- Só Circuito: bônus por locação acima da meta do dia, somado ao bônus de
  -- meta/supermeta. Deixe 0 numa unidade Playground.
  locacao_extra_bonus_cents integer not null default 0 check (locacao_extra_bonus_cents >= 0),
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_kiosk_bonus_program_config enable row level security;

create policy fa_kiosk_bonus_program_config_read on fa_kiosk_bonus_program_config
  for select to authenticated using (true);

create policy fa_kiosk_bonus_program_config_write on fa_kiosk_bonus_program_config
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));
