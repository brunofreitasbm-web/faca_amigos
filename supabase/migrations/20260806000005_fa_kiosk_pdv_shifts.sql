create table if not exists fa_kiosk_stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references fa_kiosk_products (id),
  delta integer not null,
  reason text not null,
  order_id uuid,
  at_ms bigint not null
);

create table if not exists fa_kiosk_shifts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  opened_by_employee_id uuid not null references fa_kiosk_employees (id),
  opened_at_ms bigint not null,
  opening_cash_cents integer not null default 0,
  status text not null check (status in ('ABERTO', 'FECHADO')) default 'ABERTO',
  closed_by_employee_id uuid references fa_kiosk_employees (id),
  closed_at_ms bigint,
  -- Fechamento às cegas: expected_json só é calculado dentro de
  -- fa_close_shift() (Fase 4), depois do declared_json chegar. Nenhuma
  -- policy de UPDATE direta permite a um cliente escrever expected_json.
  declared_json jsonb,
  expected_json jsonb,
  business_date date not null
);
create index if not exists idx_fa_kiosk_shifts_unit_status on fa_kiosk_shifts (unit_id, status);
-- No máximo um turno ABERTO por unidade (evita abertura dupla concorrente
-- entre dispositivos, algo que o design single-writer local garantia de graça).
create unique index if not exists idx_fa_kiosk_shifts_one_open_per_unit
  on fa_kiosk_shifts (unit_id) where status = 'ABERTO';

create table if not exists fa_kiosk_cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references fa_kiosk_shifts (id),
  kind text not null check (kind in ('TROCO_INICIAL', 'SANGRIA', 'SUPRIMENTO', 'AJUSTE')),
  amount_cents integer not null,
  reason text,
  employee_id uuid not null references fa_kiosk_employees (id),
  at_ms bigint not null
);

-- Substitui a tabela-stub fa_kiosk_orders criada manualmente no dashboard.
create table if not exists fa_kiosk_orders (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  shift_id uuid references fa_kiosk_shifts (id),
  kind text not null check (kind in ('SESSAO', 'PDV')),
  total_cents integer not null default 0,
  status text not null check (status in ('ABERTA', 'PAGA', 'CANCELADA')) default 'ABERTA',
  closed_by_employee_id uuid references fa_kiosk_employees (id),
  closed_at_ms bigint,
  business_date date not null,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
-- fa_kiosk_orders já existia (tabela-stub), sem shift_id/closed_at_ms —
-- adiciona só o que falta.
alter table fa_kiosk_orders add column if not exists shift_id uuid references fa_kiosk_shifts (id);
alter table fa_kiosk_orders add column if not exists closed_at_ms bigint;
create index if not exists idx_fa_kiosk_orders_shift on fa_kiosk_orders (shift_id);

create table if not exists fa_kiosk_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references fa_kiosk_orders (id),
  item_type text not null check (item_type in ('SESSAO', 'PRODUTO')),
  item_nature text not null check (item_nature in ('SERVICO', 'PRODUTO')),
  description text not null,
  quantity integer not null default 1,
  unit_price_cents integer not null,
  list_unit_price_cents integer not null,
  total_cents integer not null,
  product_id uuid references fa_kiosk_products (id),
  session_id uuid references fa_kiosk_sessions (id)
);
-- fa_kiosk_order_items já existia, sem item_nature/list_unit_price_cents.
alter table fa_kiosk_order_items add column if not exists item_nature text;
alter table fa_kiosk_order_items add column if not exists list_unit_price_cents integer;
create index if not exists idx_fa_kiosk_order_items_order on fa_kiosk_order_items (order_id);

create table if not exists fa_kiosk_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references fa_kiosk_orders (id),
  method text not null check (method in ('DINHEIRO', 'PIX', 'CREDITO', 'DEBITO', 'VOUCHER')),
  amount_cents integer not null,
  nsu text,
  authorization_code text,
  pix_txid text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
-- fa_kiosk_payments já existia, sem nsu/authorization_code/pix_txid.
alter table fa_kiosk_payments add column if not exists nsu text;
alter table fa_kiosk_payments add column if not exists authorization_code text;
alter table fa_kiosk_payments add column if not exists pix_txid text;
create index if not exists idx_fa_kiosk_payments_order on fa_kiosk_payments (order_id);
