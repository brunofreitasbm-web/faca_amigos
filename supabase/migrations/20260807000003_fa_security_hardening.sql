-- Fecha os buracos que tornavam qualquer RBAC decorativo. Esta migration é
-- pré-requisito da anterior valer alguma coisa: sem ela, o cliente continua
-- lendo tudo como `anon` e nenhuma policy baseada em auth.uid() é exercida.
--
-- ⚠️ ORDEM DE DEPLOY: aplicar SOMENTE junto com o kiosk-ui que exige login
-- por PIN (AppState.tsx). Aplicada isolada, o terminal atual — que hoje
-- entra sem sessão nenhuma — para de enxergar os dados.

-- ---------------------------------------------------------------------------
-- 1. Revoga o acesso anônimo aberto pela migration 16
-- ---------------------------------------------------------------------------
-- A publishable key vive dentro do bundle Vite, então é pública por
-- construção: `to anon using (true)` significava "qualquer pessoa na
-- internet lê CPF de colaborador, dado de guardião/criança, ponto e
-- faturamento". As tabelas de colaborador/ponto já tinham sido revertidas
-- na migration 26; aqui vai o resto.
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
  end loop;
end $$;

drop policy if exists fa_kiosk_app_settings_write_temp on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_print_jobs_insert_temp on fa_kiosk_print_jobs;
drop policy if exists fa_kiosk_print_jobs_update_temp on fa_kiosk_print_jobs;
drop policy if exists fa_kiosk_fiscal_terminal_status_read_anon on fa_kiosk_fiscal_terminal_status;
drop policy if exists fa_kiosk_fiscal_docs_read_anon on fa_kiosk_fiscal_docs;

-- ---------------------------------------------------------------------------
-- 2. Policies sem cláusula `to` (migration 28) — valem para PUBLIC
-- ---------------------------------------------------------------------------
-- `create policy ... for all using (true)` sem `to authenticated` alcança
-- também `anon`, e policies são combinadas por OR: enquanto estas
-- existirem, a policy de Owner criada na migration 20260807000002 não
-- restringe nada em fa_kiosk_app_settings.
drop policy if exists fa_kiosk_app_settings_read on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_app_settings_write on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_read on fa_kiosk_app_settings
  for select to authenticated using (true);
-- A escrita fica só com fa_kiosk_write_owner (migration 20260807000002).

-- Print jobs: o terminal autenticado enfileira; só o print bridge
-- (service_role, fora do RLS) atualiza o status. O UPDATE aberto permitia a
-- qualquer cliente marcar um trabalho como impresso sem ter impresso.
drop policy if exists fa_kiosk_print_jobs_read on fa_kiosk_print_jobs;
drop policy if exists fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs;
drop policy if exists fa_kiosk_print_jobs_update on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_read on fa_kiosk_print_jobs
  for select to authenticated using (true);
create policy fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs
  for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 3. Hash de PIN deixa de ser legível por qualquer colaborador
-- ---------------------------------------------------------------------------
-- A policy antiga se chamava `_self` mas usava `using (true)`: um Operador
-- autenticado baixava o pin_hash do Owner. bcrypt cost 10 sobre 10^6
-- combinações (PIN de 6 dígitos) quebra offline em minutos numa GPU —
-- escalonamento de privilégio direto. Ninguém precisa ler esta tabela pelo
-- PostgREST: só login-pin e admin-set-employee-pin encostam nela, e ambas
-- usam service role.
drop policy if exists fa_kiosk_local_credentials_self on fa_kiosk_local_credentials;
alter table fa_kiosk_local_credentials enable row level security;
revoke all on fa_kiosk_local_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. `search_path` fechado em toda função SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Sem `set search_path`, quem conseguir criar um objeto num schema que
-- apareça antes no search_path sequestra a resolução de nomes DENTRO de uma
-- função privilegiada. Como fa_kiosk_can virou o ponto de decisão de todo o
-- RBAC, isso deixa de ser teórico.
--
-- Feito por varredura em pg_proc em vez de recriar cada função: preserva os
-- corpos (não há risco de divergir de fa_checkin/fa_checkout, que são
-- longas) e cobre automaticamente as que forem adicionadas antes deste
-- deploy. Rodar de novo é idempotente.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. `grant execute on all functions ... to anon` da migration 16
-- ---------------------------------------------------------------------------
-- Postgres concede EXECUTE a PUBLIC por padrão, então revogar só de `anon`
-- não fecha nada — é preciso tirar de PUBLIC e reconceder nominalmente.
-- service_role é reconcedida explicitamente porque o print bridge e o
-- worker fiscal chamam RPC.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Exceções que NÃO voltam para authenticated:
--  - o trigger da trilha de auditoria, chamável solto via /rest/v1/rpc
--    (mesma correção da migration 27, refeita porque o grant acima a desfez);
--  - as funções do worker fiscal, que só a service role deve disparar.
revoke execute on function fa_kiosk_audit_log_hash_chain() from public, anon, authenticated;
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fa_fiscal_claim_next', 'fa_fiscal_reserve_number',
                         'fa_fiscal_enqueue_for_order', 'fa_fiscal_purge_doc_events',
                         'fa_kiosk_store_idempotency', 'fa_kiosk_check_idempotency')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Freio de força bruta no login por PIN
-- ---------------------------------------------------------------------------
-- login-pin não tinha lockout nem backoff, e `Api.employees()` entrega a
-- lista de id + papel — o atacante escolhe direto o Owner e varre 10^6
-- combinações contra uma Edge Function, o que é perfeitamente factível.
--
-- A trava é por employee_id e NÃO por IP de propósito: o balcão inteiro sai
-- por um NAT só, então banir IP derrubaria a loja. Escrita e leitura
-- exclusivas da service role (login-pin) — nenhuma policy, RLS ligado.
create table if not exists fa_kiosk_pin_attempts (
  employee_id     uuid primary key references fa_kiosk_employees (id) on delete cascade,
  failed_count    integer not null default 0,
  last_failed_ms  bigint,
  locked_until_ms bigint
);

alter table fa_kiosk_pin_attempts enable row level security;
revoke all on fa_kiosk_pin_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Mínimo de dois Owners ativos
-- ---------------------------------------------------------------------------
-- Owner único que esquece o PIN deixa o sistema sem administrador, e não há
-- caminho de volta: admin-set-employee-pin exige um ADMIN autenticado. O
-- trigger recusa rebaixar/desativar o último Owner ativo — é mais barato
-- barrar aqui do que restaurar acesso depois com service role.
create or replace function fa_kiosk_guard_last_owner() returns trigger as $$
declare
  v_remaining integer;
begin
  if old.role = 'ADMIN' and old.active
     and (new.role <> 'ADMIN' or not new.active) then
    select count(*) into v_remaining
      from fa_kiosk_employees
     where role = 'ADMIN' and active and id <> old.id;
    if v_remaining = 0 then
      raise exception 'não é possível remover o último proprietário ativo — promova outro antes'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists fa_kiosk_guard_last_owner_trg on fa_kiosk_employees;
create trigger fa_kiosk_guard_last_owner_trg
  before update on fa_kiosk_employees
  for each row execute function fa_kiosk_guard_last_owner();

revoke execute on function fa_kiosk_guard_last_owner() from public, anon, authenticated;
