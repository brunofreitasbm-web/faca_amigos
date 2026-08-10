create table if not exists fa_kiosk_assets (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  name text not null,
  emoji text not null,
  color text not null,
  status text not null check (status in ('DISPONIVEL', 'EM_USO', 'MANUTENCAO')) default 'DISPONIVEL',
  odometer_minutes integer not null default 0,
  maintenance_threshold_hours integer not null default 200,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Substitui a tabela-stub fa_kiosk_sessions criada manualmente no dashboard
-- (só tinha um shape parcial). Reconciliar com `supabase db pull` antes de
-- aplicar caso já existam linhas incompatíveis.
create table if not exists fa_kiosk_sessions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO')),
  asset_id uuid references fa_kiosk_assets (id),
  plan_id uuid not null references fa_kiosk_plans (id),
  child_id uuid not null references fa_kiosk_children (id),
  child_name_snapshot text not null,
  guardian_id uuid not null references fa_kiosk_guardians (id),
  wristband_code text not null unique,
  ticket_code text not null unique,
  checkin_at_ms bigint not null,
  checkin_by_employee_id uuid references fa_kiosk_employees (id),
  checkout_at_ms bigint,
  status text not null check (status in ('ATIVA', 'AGUARDANDO_PAGAMENTO', 'FINALIZADA')) default 'ATIVA',
  coupon_id uuid references fa_kiosk_coupons (id),
  coupon_discount_cents integer not null default 0,
  free_from_loyalty boolean not null default false,
  order_id uuid,
  business_date date not null
);
-- fa_kiosk_sessions já existia (tabela-stub), sem asset_id/coupon_id e com
-- checkin_at/checkout_at (timestamptz) em vez de checkin_at_ms/checkout_at_ms
-- — adiciona só o que falta, sem mexer nas colunas timestamptz existentes.
alter table fa_kiosk_sessions add column if not exists asset_id uuid references fa_kiosk_assets (id);
alter table fa_kiosk_sessions add column if not exists coupon_id uuid;
alter table fa_kiosk_sessions add column if not exists checkin_at_ms bigint;
alter table fa_kiosk_sessions add column if not exists checkout_at_ms bigint;
create index if not exists idx_fa_kiosk_sessions_unit_status on fa_kiosk_sessions (unit_id, status);

-- Append-only: reconstrói qualquer sessão sem depender de UPDATE, inclusive
-- para defesa jurídica sobre retirada da criança.
create table if not exists fa_kiosk_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references fa_kiosk_sessions (id),
  kind text not null,
  at_ms bigint not null,
  employee_id uuid references fa_kiosk_employees (id),
  payload_json jsonb
);
create index if not exists idx_fa_kiosk_session_events_session on fa_kiosk_session_events (session_id, at_ms);

do $$ begin
  alter publication supabase_realtime add table fa_kiosk_sessions;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;
