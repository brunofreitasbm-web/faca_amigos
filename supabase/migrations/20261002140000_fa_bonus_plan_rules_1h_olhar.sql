-- Bônus de Planos Longos: inclui o plano de 1 hora ("1 hora + Olhar FaçaAmigos") e
-- sobe o teto próprio do bloco de R$ 100 para R$ 200 por operador/mês.
-- Decisão do dono em 02/10/2026; regras em docs/bonificacao/programa-planos-longos-out-2026.md
-- e manual do operador em docs/bonificacao/manual-bonificacao.md.
--
-- Métrica: R$ 1,00 por criança em plano de 1 h (check-in no PIN do operador, pedido pago,
-- sem saldo de pacote) + escada de 100 no mês (+ R$ 20,00). O motor de apuração já trata
-- qualquer plano cadastrado em fa_kiosk_bonus_plan_rules, então não há mudança de código.
--
-- O plano é achado pelo que ele é (Playground, 1 HORA, ativo) e não por UUID, porque o id
-- de produção não está no repositório. Em banco sem esse plano (dev, staging) não insere nada.

insert into fa_kiosk_bonus_plan_rules
  (unit_id, kind, ref_id, label, bonus_cents, escada_meta, escada_bonus_cents, active, sort_order, updated_at_ms)
select p.unit_id, 'PLANO', p.id, '1 hora + Olhar', 100, 100, 2000, true, 0,
       (extract(epoch from now()) * 1000)::bigint
from fa_kiosk_plans p
where p.unit_id = '11111111-1111-1111-1111-111111111111'
  and p.activity = 'PLAYGROUND'
  and p.duration_unit = 'HORA'
  and p.duration_value = 1
  and p.active
on conflict (unit_id, kind, ref_id) do update set
  label = excluded.label,
  bonus_cents = excluded.bonus_cents,
  escada_meta = excluded.escada_meta,
  escada_bonus_cents = excluded.escada_bonus_cents,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at_ms = excluded.updated_at_ms;

-- Teto próprio do bloco: R$ 200/mês por operador, fora do teto de metas/produtos (R$ 200).
update fa_kiosk_bonus_program_config
   set planos_teto_mes_cents = 20000,
       updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where unit_id = '11111111-1111-1111-1111-111111111111';
