-- Guardiões, crianças e o log de visitas (append-only — base do selo de
-- frequência em packages/domain/loyalty/visit-frequency).

create table if not exists fa_kiosk_guardians (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_e164 text not null unique,
  cpf text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
-- fa_kiosk_guardians já existia (criada antes, sem cpf) — adiciona a coluna que falta.
alter table fa_kiosk_guardians add column if not exists cpf text;
create unique index if not exists idx_fa_kiosk_guardians_cpf on fa_kiosk_guardians (cpf) where cpf is not null;

create table if not exists fa_kiosk_children (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birth_date date not null,
  inclusive_eligible boolean not null default false,
  inclusive_proof_type text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_kiosk_child_guardians (
  child_id uuid not null references fa_kiosk_children (id),
  guardian_id uuid not null references fa_kiosk_guardians (id),
  is_authorized_pickup boolean not null default true,
  primary key (child_id, guardian_id)
);

-- Append-only: um fato que já aconteceu, nunca é alterado depois de gravado.
create table if not exists fa_kiosk_visit_log (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references fa_kiosk_children (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO')),
  at_ms bigint not null
);
-- fa_kiosk_visit_log já existia com uma coluna `at` (timestamptz) em vez
-- de `at_ms` — adiciona at_ms sem mexer em `at`.
alter table fa_kiosk_visit_log add column if not exists at_ms bigint;
alter table fa_kiosk_visit_log alter column at_ms drop not null;
create index if not exists idx_fa_kiosk_visit_log_child on fa_kiosk_visit_log (child_id, at_ms);
