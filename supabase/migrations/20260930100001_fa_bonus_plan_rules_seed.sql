-- Semeia o Bônus de Planos Longos do Playground (Parque Shopping) com os valores
-- decididos em docs/bonificacao/programa-planos-longos-out-2026.md.
-- Guardado por "exists": em banco sem esses planos/pacotes (dev, staging) não insere nada.

insert into fa_kiosk_bonus_plan_rules
  (unit_id, kind, ref_id, label, bonus_cents, escada_meta, escada_bonus_cents, active, sort_order, updated_at_ms)
select '11111111-1111-1111-1111-111111111111', v.kind, v.ref_id::uuid, v.label, v.bonus_cents, v.escada_meta,
       v.escada_bonus_cents, true, v.sort_order, (extract(epoch from now()) * 1000)::bigint
from (values
  ('PLANO',  'e3345467-f583-412c-ab49-82b989fb000d', '2 horas',       300, 12, 1500, 1),
  ('PACOTE', '1dc648d9-8c66-4559-a3a7-0424f814626a', 'DAY USE',      1000,  2, 1000, 2),
  ('PACOTE', '5e3b3e92-9694-458b-880e-69fe937590d3', 'PORTO SEGURO', 2500,  1, 1500, 3)
) as v(kind, ref_id, label, bonus_cents, escada_meta, escada_bonus_cents, sort_order)
where exists (select 1 from fa_kiosk_units where id = '11111111-1111-1111-1111-111111111111')
  and case v.kind
        when 'PLANO'  then exists (select 1 from fa_kiosk_plans    where id = v.ref_id::uuid)
        when 'PACOTE' then exists (select 1 from fa_kiosk_packages where id = v.ref_id::uuid)
      end
on conflict (unit_id, kind, ref_id) do update set
  label = excluded.label,
  bonus_cents = excluded.bonus_cents,
  escada_meta = excluded.escada_meta,
  escada_bonus_cents = excluded.escada_bonus_cents,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at_ms = excluded.updated_at_ms;

-- Teto próprio de R$ 100/mês por operador, fora do teto de metas/produtos.
update fa_kiosk_bonus_program_config
   set planos_teto_mes_cents = 10000,
       updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where unit_id = '11111111-1111-1111-1111-111111111111';
