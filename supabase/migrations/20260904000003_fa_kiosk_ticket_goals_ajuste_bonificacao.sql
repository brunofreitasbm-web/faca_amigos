-- Fase 2 da Bonificação (docs/bonificacao/programa-bonificacao-set-2026.md,
-- seção "Fase 2 de sistema"): as metas de ticket médio cadastradas em
-- fa_kiosk_unit_ticket_goals estavam desalinhadas com a realidade medida em
-- 19/08-02/09 —
--   Playground: mín R$ 60 / alvo R$ 120, real R$ 98/pedido (alvo inatingível
--   com o cupom de 40% ativo em quase toda venda).
--   Circuito: mín R$ 45 / alvo R$ 53, real R$ 56/pedido (alvo já batido, o
--   termômetro não incentiva nada).
-- Ajusta pros valores já usados na simulação do documento: Playground
-- mín R$ 85 / alvo R$ 105; Circuito mín R$ 50 / alvo R$ 58.

insert into fa_kiosk_unit_ticket_goals (unit_id, min_ticket_cents, target_ticket_cents, updated_at_ms)
values ('11111111-1111-1111-1111-111111111111', 8500, 10500, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id) do update set
  min_ticket_cents = excluded.min_ticket_cents,
  target_ticket_cents = excluded.target_ticket_cents,
  updated_at_ms = excluded.updated_at_ms;

insert into fa_kiosk_unit_ticket_goals (unit_id, min_ticket_cents, target_ticket_cents, updated_at_ms)
values ('e43ba7a8-bd5f-47ad-b81d-dae7ea19d504', 5000, 5800, (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id) do update set
  min_ticket_cents = excluded.min_ticket_cents,
  target_ticket_cents = excluded.target_ticket_cents,
  updated_at_ms = excluded.updated_at_ms;
