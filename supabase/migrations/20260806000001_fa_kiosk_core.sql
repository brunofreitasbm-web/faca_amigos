-- Núcleo/catálogo. fa_kiosk_units, fa_kiosk_employees, fa_kiosk_plans e
-- fa_kiosk_products já existem no projeto (criadas manualmente pelo
-- dashboard, ver apps/backoffice/README.md) — por isso usamos
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS em vez de
-- assumir que a tabela está vazia. Rode `supabase db pull` ANTES desta
-- migration para confirmar que os tipos abaixo batem com o que já existe;
-- ajuste esta migration se houver divergência antes de aplicar.

create extension if not exists pgcrypto;

create table if not exists fa_kiosk_units (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('LOJA', 'QUIOSQUE')),
  name text not null,
  timezone text not null default 'America/Belem',
  business_day_cutoff_hour integer not null default 4,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_kiosk_app_settings (
  unit_id uuid not null references fa_kiosk_units (id),
  key text not null,
  value text not null,
  updated_at_ms bigint not null,
  primary key (unit_id, key)
);

create table if not exists fa_kiosk_employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users (id),
  full_name text not null,
  role text not null check (role in ('OPERADOR', 'GERENTE', 'ADMIN')),
  pis text,
  cpf_last4 text,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table fa_kiosk_employees add column if not exists auth_user_id uuid references auth.users (id);
create unique index if not exists idx_fa_kiosk_employees_auth_user on fa_kiosk_employees (auth_user_id) where auth_user_id is not null;

-- PIN local é só atalho de digitação (Fase 1) — a validação de verdade é
-- sempre a conta Supabase Auth (auth_user_id acima). O hash aqui nunca
-- concede acesso sozinho.
create table if not exists fa_kiosk_local_credentials (
  employee_id uuid primary key references fa_kiosk_employees (id),
  pin_hash text not null,
  must_change boolean not null default false,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_kiosk_plans (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO')),
  name text not null,
  value_cents integer not null,
  duration_value integer not null,
  duration_unit text not null check (duration_unit in ('MINUTO', 'HORA')),
  overage_cents_per_minute integer not null,
  color text not null default '#2ECFB5',
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table fa_kiosk_plans add column if not exists color text not null default '#2ECFB5';

create table if not exists fa_kiosk_products (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  name text not null,
  description text,
  emoji text,
  price_cents integer not null,
  stock integer not null default 0,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_kiosk_bonus_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  description text not null,
  reward_value_cents integer not null,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
