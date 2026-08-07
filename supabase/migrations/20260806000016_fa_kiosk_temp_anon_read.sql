-- TEMPORÁRIO — a pedido do dono, oculta a tela de login do kiosk-ui por
-- enquanto (não há operação diária ainda usando contas reais). Sem sessão
-- Supabase Auth, o cliente atua como `anon`, então as policies de leitura
-- criadas para "authenticated" (migration 09) não bastam. Este arquivo só
-- adiciona SELECT para `anon` nas mesmas tabelas — nenhuma policy de
-- escrita muda (INSERT/UPDATE continuam só via função SECURITY DEFINER
-- ou GERENTE/ADMIN autenticado).
--
-- REVERTER quando o login real (Fase 1) voltar a ser exigido: rodar
--   drop policy fa_kiosk_read_anon_temp on <tabela>;
-- para cada tabela abaixo.

do $$
declare
  t text;
begin
  foreach t in array array[
    'fa_kiosk_units', 'fa_kiosk_app_settings', 'fa_kiosk_plans', 'fa_kiosk_products',
    'fa_kiosk_bonus_rules', 'fa_kiosk_assets', 'fa_kiosk_coupons', 'fa_kiosk_loyalty_rules',
    'fa_kiosk_employees', 'fa_kiosk_guardians', 'fa_kiosk_children', 'fa_kiosk_child_guardians',
    'fa_kiosk_sessions', 'fa_kiosk_session_events', 'fa_kiosk_visit_log', 'fa_kiosk_loyalty_rewards',
    'fa_kiosk_stock_movements', 'fa_kiosk_shifts', 'fa_kiosk_cash_movements', 'fa_kiosk_orders',
    'fa_kiosk_order_items', 'fa_kiosk_payments', 'fa_kiosk_ponto_records', 'fa_kiosk_print_jobs'
  ]
  loop
    execute format('drop policy if exists fa_kiosk_read_anon_temp on %I', t);
    execute format('create policy fa_kiosk_read_anon_temp on %I for select to anon using (true)', t);
  end loop;
end $$;

drop policy if exists fa_kiosk_app_settings_write_temp on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_write_temp on fa_kiosk_app_settings for all to anon using (true) with check (true);

drop policy if exists fa_kiosk_print_jobs_insert_temp on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_insert_temp on fa_kiosk_print_jobs for insert to anon with check (true);

drop policy if exists fa_kiosk_print_jobs_update_temp on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_update_temp on fa_kiosk_print_jobs for update to anon using (true) with check (true);

-- Garantia explícita de execução das RPCs por `anon` (Postgres já concede
-- EXECUTE a PUBLIC por padrão, isto só documenta a intenção).
grant execute on all functions in schema public to anon;
