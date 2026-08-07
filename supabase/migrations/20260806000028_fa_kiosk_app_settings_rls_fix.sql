-- Correção de RLS para fa_kiosk_app_settings e fa_kiosk_print_jobs.
-- Permite que o kiosk-ui (seja em modo temporário anon ou authenticated)
-- salve configurações de impressoras/unidade e enfileire trabalhos de impressão.

alter table fa_kiosk_app_settings enable row level security;

drop policy if exists fa_kiosk_app_settings_read on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_read_authenticated on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_read on fa_kiosk_app_settings
  for select using (true);

drop policy if exists fa_kiosk_app_settings_write on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_write_manager on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_write on fa_kiosk_app_settings
  for all using (true) with check (true);

-- fa_kiosk_print_jobs
alter table fa_kiosk_print_jobs enable row level security;

drop policy if exists fa_kiosk_print_jobs_read on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_read on fa_kiosk_print_jobs
  for select using (true);

drop policy if exists fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs
  for insert with check (true);

drop policy if exists fa_kiosk_print_jobs_update on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_update on fa_kiosk_print_jobs
  for update using (true) with check (true);
