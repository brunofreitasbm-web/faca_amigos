-- Semeia fa_kiosk_bonus_program_goals/config (migration anterior) com os
-- valores que já estavam hardcoded em apuracaoBonificacao.ts/bonificacao.ts
-- para as duas unidades do piloto — não muda nada do que está em produção
-- agora, só move o número de dentro do código para dentro da configuração
-- que o Owner passa a poder editar em Gerencial > Metas.

-- Playground (Parque Shopping) — meta em faturamento (centavos)
insert into fa_kiosk_bonus_program_goals (unit_id, weekday, meta_valor, super_valor, meta_bonus_cents, super_bonus_cents, updated_at_ms) values
  ('11111111-1111-1111-1111-111111111111', 1, 90000,  110000, 800,  1200, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 2, 90000,  110000, 800,  1200, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 3, 90000,  110000, 800,  1200, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 4, 90000,  110000, 800,  1200, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 5, 150000, 180000, 1200, 1600, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 6, 240000, 280000, 1200, 1600, (extract(epoch from now()) * 1000)::bigint),
  ('11111111-1111-1111-1111-111111111111', 7, 220000, 260000, 1200, 1600, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, weekday) do update set
  meta_valor = excluded.meta_valor,
  super_valor = excluded.super_valor,
  meta_bonus_cents = excluded.meta_bonus_cents,
  super_bonus_cents = excluded.super_bonus_cents,
  updated_at_ms = excluded.updated_at_ms;

-- Circuito (Parque Shopping) — meta em nº de locações
insert into fa_kiosk_bonus_program_goals (unit_id, weekday, meta_valor, super_valor, meta_bonus_cents, super_bonus_cents, updated_at_ms) values
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 1, 8,  10, 600,  1000, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 2, 8,  10, 600,  1000, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 3, 8,  10, 600,  1000, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 4, 8,  10, 600,  1000, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 5, 10, 12, 1000, 1600, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 6, 22, 27, 1000, 1600, (extract(epoch from now()) * 1000)::bigint),
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 7, 30, 35, 1000, 1600, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, weekday) do update set
  meta_valor = excluded.meta_valor,
  super_valor = excluded.super_valor,
  meta_bonus_cents = excluded.meta_bonus_cents,
  super_bonus_cents = excluded.super_bonus_cents,
  updated_at_ms = excluded.updated_at_ms;

-- Config geral (teto, produto, itens do mês, bônus extras por tipo de unidade)
insert into fa_kiosk_bonus_program_config (
  unit_id, teto_mes_cents, produto_preco_corte_cents, produto_bonus_baixo_cents, produto_bonus_alto_cents,
  itens_mes_meta, itens_mes_bonus_cents, sessao_1h_percentual_min, sessao_1h_bonus_cents, locacao_extra_bonus_cents, updated_at_ms
) values
  -- Playground: bônus de sessão 1h+ (>=45% das sessões), sem bônus de locação extra.
  ('11111111-1111-1111-1111-111111111111', 20000, 4000, 200, 400, 10, 1000, 45, 200, 0, (extract(epoch from now()) * 1000)::bigint),
  -- Circuito: bônus de R$1 por locação acima da meta, sem bônus de sessão 1h.
  ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 20000, 4000, 200, 400, 10, 1000, 0, 0, 100, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id) do update set
  teto_mes_cents = excluded.teto_mes_cents,
  produto_preco_corte_cents = excluded.produto_preco_corte_cents,
  produto_bonus_baixo_cents = excluded.produto_bonus_baixo_cents,
  produto_bonus_alto_cents = excluded.produto_bonus_alto_cents,
  itens_mes_meta = excluded.itens_mes_meta,
  itens_mes_bonus_cents = excluded.itens_mes_bonus_cents,
  sessao_1h_percentual_min = excluded.sessao_1h_percentual_min,
  sessao_1h_bonus_cents = excluded.sessao_1h_bonus_cents,
  locacao_extra_bonus_cents = excluded.locacao_extra_bonus_cents,
  updated_at_ms = excluded.updated_at_ms;
