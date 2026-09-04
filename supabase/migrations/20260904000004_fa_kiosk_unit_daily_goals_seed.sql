-- Cadastra a Meta diária de faturamento (fa_kiosk_unit_daily_goals,
-- migration 20260904000001) pelas duas unidades — até aqui a tabela
-- ficou vazia de propósito, esperando o Owner decidir os valores.
--
-- Playground: reaproveita literalmente o patamar "meta" (não supermeta)
-- já usado no card 🎮 Bonificação de hoje (apps/kiosk-ui/src/bonificacao.ts,
-- docs/bonificacao/programa-bonificacao-set-2026.md seção 4.1) — mesmo
-- número, sem inventar nada novo, e evita o termômetro "Meta do dia" e o
-- card de bonificação mostrarem valores diferentes pro mesmo dia.
--
-- Circuito: a bonificação daquela unidade mede em locações, não em
-- faturamento, então não existe um valor em R$ já decidido. Convertido
-- aqui multiplicando a meta de locações (seção 4.2 do mesmo documento:
-- seg-qui 8, sex 10, sáb 22, dom 30) pelo ticket médio real medido no
-- diagnóstico (R$ 54-57/locação, seção 3 — usei o piso R$ 54 pra não
-- inflar a meta), arredondado pra dezena. É uma estimativa, não uma
-- decisão de negócio nova: o Owner pode ajustar em Gerencial →
-- Configurações → Meta a qualquer momento.

-- Playground (Parque Shopping)
insert into fa_kiosk_unit_daily_goals (unit_id, weekday, goal_cents, updated_at_ms) values
  ('11111111-1111-1111-1111-111111111111', 1, 90000,  (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 2, 90000,  (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 3, 90000,  (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 4, 90000,  (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 5, 150000, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 6, 240000, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 7, 220000, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, weekday) do update set
  goal_cents = excluded.goal_cents,
  updated_at_ms = excluded.updated_at_ms;

-- Circuito (Parque Shopping) — locações-meta × R$ 54, arredondado
insert into fa_kiosk_unit_daily_goals (unit_id, weekday, goal_cents, updated_at_ms) values
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 1, 43000,  (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 2, 43000,  (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 3, 43000,  (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 4, 43000,  (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 5, 54000,  (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 6, 119000, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 7, 162000, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, weekday) do update set
  goal_cents = excluded.goal_cents,
  updated_at_ms = excluded.updated_at_ms;
