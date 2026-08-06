-- Fase 6: ponte de impressão. O print bridge local (Electron) assina esta
-- tabela via Realtime e aciona a impressora térmica física — o dado em si
-- não precisa ficar no dispositivo, só o comando de imprimir passa por aqui.
create table if not exists fa_kiosk_print_jobs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  kind text not null check (kind in ('WRISTBAND', 'RECEIPT')),
  payload_json jsonb not null,
  status text not null check (status in ('PENDING', 'PRINTED', 'FAILED')) default 'PENDING',
  error text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  printed_at_ms bigint
);
create index if not exists idx_fa_kiosk_print_jobs_unit_status on fa_kiosk_print_jobs (unit_id, status);

alter publication supabase_realtime add table fa_kiosk_print_jobs;
