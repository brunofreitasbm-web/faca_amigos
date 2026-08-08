-- A aba gerencial "Saldo em Caixa" mostrava o dinheiro na gaveta, mas a
-- pergunta real do dono é outra: quanto há em ENVELOPES em cada loja agora.
-- Envelope = sangria com envelope_number (ver migration 070000). Até aqui os
-- envelopes só acumulavam para sempre — não existia o momento em que o dono
-- passa na loja e leva os envelopes embora. Este arquivo cria esse ciclo:
-- envelope PENDENTE (na loja) → RECOLHIDO (retirado pelo gestor).

alter table fa_kiosk_cash_movements add column if not exists collected_at_ms bigint;
alter table fa_kiosk_cash_movements add column if not exists collected_by_employee_id uuid;

-- Saldo em envelopes por unidade: soma do que ainda está na loja (pendente),
-- quantos envelopes são, desde quando o mais antigo espera, e quando foi o
-- último recolhimento. Sangrias sem envelope_number ficam de fora — são
-- retiradas avulsas, mesma regra da aba "Fotos de Envelope".
create or replace function fa_units_envelope_balance()
returns table (
  unit_id uuid,
  unit_name text,
  pending_cents bigint,
  pending_count bigint,
  oldest_pending_at_ms bigint,
  last_collected_at_ms bigint
) as $$
  select
    u.id as unit_id,
    u.name as unit_name,
    coalesce(sum(m.amount_cents) filter (where m.collected_at_ms is null), 0) as pending_cents,
    count(m.id) filter (where m.collected_at_ms is null) as pending_count,
    min(m.at_ms) filter (where m.collected_at_ms is null) as oldest_pending_at_ms,
    max(m.collected_at_ms) as last_collected_at_ms
  from fa_kiosk_units u
  left join fa_kiosk_shifts s on s.unit_id = u.id
  left join fa_kiosk_cash_movements m
    on m.shift_id = s.id and m.kind = 'SANGRIA' and m.envelope_number is not null
  group by u.id, u.name;
$$ language sql stable security definer;

-- Recolhimento: marca de uma vez todos os envelopes pendentes da unidade.
-- É tudo-ou-nada por loja de propósito — no mundo físico o gestor abre o
-- cofre/gaveta e leva o maço inteiro, não escolhe envelope por envelope.
create or replace function fa_collect_envelopes(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_count bigint;
  v_total bigint;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  with upd as (
    update fa_kiosk_cash_movements m
    set collected_at_ms = (extract(epoch from now()) * 1000)::bigint,
        collected_by_employee_id = p_employee_id
    from fa_kiosk_shifts s
    where s.id = m.shift_id
      and s.unit_id = p_unit_id
      and m.kind = 'SANGRIA'
      and m.envelope_number is not null
      and m.collected_at_ms is null
    returning m.amount_cents
  )
  select count(*), coalesce(sum(amount_cents), 0) into v_count, v_total from upd;

  v_cached := jsonb_build_object('ok', true, 'collected_count', v_count, 'collected_cents', v_total);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_collect_envelopes', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
