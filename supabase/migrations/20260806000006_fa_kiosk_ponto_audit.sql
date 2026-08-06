-- Bater ponto (Portaria MTP 671/2021). NSR agora vem de uma sequence real
-- do Postgres (antes era "grátis" por o SQLite local ser single-writer) —
-- garante sequência sem gaps/colisão mesmo com múltiplos dispositivos
-- escrevendo ao mesmo tempo. Sem endpoint nem policy de exclusão: a
-- garantia "não é possível apagar/corrigir um ponto batido" agora é
-- reforçada pelo próprio banco, não só por convenção da aplicação.
create sequence if not exists fa_kiosk_ponto_nsr_seq;

create table if not exists fa_kiosk_ponto_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references fa_kiosk_employees (id),
  unit_id uuid not null references fa_kiosk_units (id),
  kind text not null check (kind in ('ENTRADA', 'SAIDA', 'INTERVALO_INICIO', 'INTERVALO_FIM')),
  nsr bigint not null unique default nextval('fa_kiosk_ponto_nsr_seq'),
  at_ms bigint not null,
  registered_by_employee_id uuid references fa_kiosk_employees (id)
);
create index if not exists idx_fa_kiosk_ponto_employee on fa_kiosk_ponto_records (employee_id, at_ms);

-- Encadeado por hash: prev_hash/self_hash tornam adulteração retroativa
-- detectável. self_hash agora é calculado por trigger no servidor (nunca
-- mais confiado ao app) — mais forte que o design anterior, onde nada
-- impedia o processo local de forjar o hash antes de inserir.
create table if not exists fa_kiosk_audit_log (
  id uuid primary key default gen_random_uuid(),
  at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  employee_id uuid references fa_kiosk_employees (id),
  action text not null,
  severity text not null check (severity in ('INFO', 'ALERTA')) default 'INFO',
  details_json jsonb,
  prev_hash text,
  self_hash text not null default ''
);

create or replace function fa_kiosk_audit_log_hash_chain() returns trigger as $$
declare
  last_hash text;
begin
  select self_hash into last_hash from fa_kiosk_audit_log order by at_ms desc, id desc limit 1;
  new.prev_hash := last_hash;
  new.self_hash := encode(
    digest(coalesce(last_hash, '') || new.id::text || new.at_ms::text || new.action || coalesce(new.details_json::text, ''), 'sha256'),
    'hex'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_fa_kiosk_audit_log_hash_chain on fa_kiosk_audit_log;
create trigger trg_fa_kiosk_audit_log_hash_chain
  before insert on fa_kiosk_audit_log
  for each row execute function fa_kiosk_audit_log_hash_chain();
