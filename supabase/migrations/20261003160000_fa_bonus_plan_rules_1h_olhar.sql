-- Bônus de Planos Longos, versão do deck "Bonificação FaçaAmigos" (08/09 a 31/10/2026):
--   1. Inclui "1 hora + Olhar": R$ 1 por criança, escada de 100 no mês paga + R$ 20.
--   2. Teto próprio do bloco C sobe de R$ 100 para R$ 200 por operador/mês.
-- Os demais valores (2 horas, Day Use, Porto Seguro) já estavam semeados em
-- 20260930100001 e batem com o deck. As metas do bloco A e os produtos do bloco B
-- também já batem com 20260911100001.
-- O "Olhar preenchido em até 40 min da saída" NÃO é verificado aqui: a regra conta
-- toda sessão paga do plano de 1 hora com check-in no PIN do operador.

insert into fa_kiosk_bonus_plan_rules
  (unit_id, kind, ref_id, label, bonus_cents, escada_meta, escada_bonus_cents, active, sort_order, updated_at_ms)
select '11111111-1111-1111-1111-111111111111', 'PLANO', '26241007-1f11-4442-83de-7caa7805959e',
       '1 hora + Olhar', 100, 100, 2000, true, 0, (extract(epoch from now()) * 1000)::bigint
where exists (select 1 from fa_kiosk_plans where id = '26241007-1f11-4442-83de-7caa7805959e')
on conflict (unit_id, kind, ref_id) do update set
  label = excluded.label,
  bonus_cents = excluded.bonus_cents,
  escada_meta = excluded.escada_meta,
  escada_bonus_cents = excluded.escada_bonus_cents,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at_ms = excluded.updated_at_ms;

update fa_kiosk_bonus_program_config
   set planos_teto_mes_cents = 20000,
       updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where unit_id = '11111111-1111-1111-1111-111111111111';
