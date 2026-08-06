create table if not exists fa_kiosk_coupons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  code text not null,
  kind text not null check (kind in ('MINUTOS_EXTRA', 'DESCONTO_PCT', 'DESCONTO_VALOR')),
  value integer not null,
  max_uses integer not null default 0,
  used_count integer not null default 0,
  active boolean not null default true,
  description text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (unit_id, code),
  check (max_uses = 0 or used_count <= max_uses)
);

create table if not exists fa_kiosk_loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO', 'AMBOS')),
  trigger_visits integer not null,
  reward_kind text not null check (reward_kind in ('ENTRADA_GRATIS', 'DESCONTO_PCT', 'MINUTOS_EXTRA')),
  reward_value integer not null,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Ledger append-only: saldo de recompensa nunca sofre UPDATE de valor.
-- Resgate grava redeemed_at_ms/redeemed_session_id via fa_redeem_loyalty_reward()
-- (Fase 3) — nunca por UPDATE direto liberado a clientes (ver RLS).
create table if not exists fa_kiosk_loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references fa_kiosk_children (id),
  rule_id uuid not null references fa_kiosk_loyalty_rules (id),
  earned_at_ms bigint not null,
  redeemed_at_ms bigint,
  redeemed_session_id uuid
);
