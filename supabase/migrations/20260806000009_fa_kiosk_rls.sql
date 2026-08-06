-- RLS real, substituindo as policies `_temp` permissivas (commit
-- f1c7f96) criadas manualmente no dashboard enquanto não havia usuários.
-- IMPORTANTE: as policies `_temp` foram criadas fora do repositório
-- (direto no dashboard) — remova-as manualmente em Authentication > Policies
-- depois de aplicar esta migration e de criar as contas reais dos
-- funcionários (Fase 1), senão elas continuam liberando acesso anônimo
-- em paralelo com as policies abaixo.

create or replace function fa_kiosk_current_employee_id() returns uuid as $$
  select id from fa_kiosk_employees where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer;

create or replace function fa_kiosk_has_role(min_role text) returns boolean as $$
  select case min_role
    when 'OPERADOR' then role in ('OPERADOR', 'GERENTE', 'ADMIN')
    when 'GERENTE' then role in ('GERENTE', 'ADMIN')
    when 'ADMIN' then role = 'ADMIN'
    else false
  end
  from fa_kiosk_employees where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer;

-- Tabelas de referência: qualquer funcionário autenticado lê; só
-- GERENTE/ADMIN altera via ConfiguracoesScreen.
do $$
declare
  t text;
begin
  foreach t in array array['fa_kiosk_units', 'fa_kiosk_app_settings', 'fa_kiosk_plans', 'fa_kiosk_products',
                            'fa_kiosk_bonus_rules', 'fa_kiosk_assets', 'fa_kiosk_coupons', 'fa_kiosk_loyalty_rules']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists fa_kiosk_read_authenticated on %I', t);
    execute format('create policy fa_kiosk_read_authenticated on %I for select to authenticated using (true)', t);
    execute format('drop policy if exists fa_kiosk_write_manager on %I', t);
    execute format('create policy fa_kiosk_write_manager on %I for all to authenticated using (fa_kiosk_has_role(''GERENTE'')) with check (fa_kiosk_has_role(''GERENTE''))', t);
  end loop;
end $$;

alter table fa_kiosk_employees enable row level security;
drop policy if exists fa_kiosk_employees_read on fa_kiosk_employees;
create policy fa_kiosk_employees_read on fa_kiosk_employees for select to authenticated using (true);
drop policy if exists fa_kiosk_employees_write_admin on fa_kiosk_employees;
create policy fa_kiosk_employees_write_admin on fa_kiosk_employees for all to authenticated
  using (fa_kiosk_has_role('ADMIN')) with check (fa_kiosk_has_role('ADMIN'));

alter table fa_kiosk_local_credentials enable row level security;
drop policy if exists fa_kiosk_local_credentials_self on fa_kiosk_local_credentials;
create policy fa_kiosk_local_credentials_self on fa_kiosk_local_credentials for select to authenticated
  using (true);

-- Guardiões/crianças: busca (autocomplete) precisa de SELECT direto, mas
-- INSERT/UPDATE só acontece dentro de fa_checkin() (SECURITY DEFINER,
-- Fase 3) — nunca direto do cliente, para manter o upsert-por-CPF/telefone
-- consistente e auditável.
do $$
declare
  t text;
begin
  foreach t in array array['fa_kiosk_guardians', 'fa_kiosk_children', 'fa_kiosk_child_guardians']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists fa_kiosk_read_authenticated on %I', t);
    execute format('create policy fa_kiosk_read_authenticated on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Transacionais: só leitura direta para o cliente autenticado; toda
-- escrita passa por função SECURITY DEFINER (Fases 3-5), que roda como o
-- dono da tabela e por isso ignora RLS de INSERT/UPDATE por design.
do $$
declare
  t text;
begin
  foreach t in array array['fa_kiosk_sessions', 'fa_kiosk_session_events', 'fa_kiosk_visit_log',
                            'fa_kiosk_loyalty_rewards', 'fa_kiosk_stock_movements', 'fa_kiosk_shifts',
                            'fa_kiosk_cash_movements', 'fa_kiosk_orders', 'fa_kiosk_order_items',
                            'fa_kiosk_payments', 'fa_kiosk_ponto_records', 'fa_kiosk_audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists fa_kiosk_read_authenticated on %I', t);
    execute format('create policy fa_kiosk_read_authenticated on %I for select to authenticated using (true)', t);
    -- Nenhuma policy de insert/update/delete: só service_role ou funções
    -- SECURITY DEFINER (que rodam como dono da tabela) conseguem escrever.
  end loop;
end $$;

-- Print jobs: o kiosk-ui insere o pedido de impressão diretamente; só o
-- print bridge (service_role, fora do RLS) atualiza o status.
alter table fa_kiosk_print_jobs enable row level security;
drop policy if exists fa_kiosk_print_jobs_read on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_read on fa_kiosk_print_jobs for select to authenticated using (true);
drop policy if exists fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs for insert to authenticated with check (true);

-- Idempotency keys: uso interno das funções apenas, sem acesso de cliente.
alter table fa_kiosk_idempotency_keys enable row level security;
