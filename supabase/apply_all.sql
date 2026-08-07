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
create table if not exists fa_kiosk_coupons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  code text not null,
  kind text not null check (kind in ('MINUTOS_EXTRA', 'DESCONTO_PCT', 'DESCONTO_VALOR')),
  value integer not null,
  max_uses integer not null default 0,
  used_count integer not null default 0,
  active boolean not null default true,
  description text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (unit_id, code),
  check (max_uses = 0 or used_count <= max_uses)
);

create table if not exists fa_kiosk_loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO', 'AMBOS')),
  trigger_visits integer not null,
  reward_kind text not null check (reward_kind in ('ENTRADA_GRATIS', 'DESCONTO_PCT', 'MINUTOS_EXTRA')),
  reward_value integer not null,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Ledger append-only: saldo de recompensa nunca sofre UPDATE de valor.
-- Resgate grava redeemed_at_ms/redeemed_session_id via fa_redeem_loyalty_reward()
-- (Fase 3) — nunca por UPDATE direto liberado a clientes (ver RLS).
create table if not exists fa_kiosk_loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references fa_kiosk_children (id),
  rule_id uuid not null references fa_kiosk_loyalty_rules (id),
  earned_at_ms bigint not null,
  redeemed_at_ms bigint,
  redeemed_session_id uuid
);
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

alter publication supabase_realtime add table fa_kiosk_sessions;
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
-- Fase 3: suporte a reenvio idempotente quando o totem enfileira uma
-- chamada localmente (IndexedDB) por causa de uma queda breve de rede e
-- reenvia depois. Cada RPC transacional (fa_checkin, fa_checkout,
-- fa_create_pdv_order, fa_close_shift, fa_register_ponto) deve chamar
-- fa_kiosk_check_idempotency() no início e fa_kiosk_store_idempotency()
-- antes de retornar, para que um reenvio da mesma idempotency_key
-- devolva o resultado já processado em vez de duplicar o efeito.
create table if not exists fa_kiosk_idempotency_keys (
  idempotency_key text primary key,
  rpc_name text not null,
  result_json jsonb,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_fa_kiosk_idempotency_created on fa_kiosk_idempotency_keys (created_at_ms);

create or replace function fa_kiosk_check_idempotency(p_key text) returns jsonb as $$
  select result_json from fa_kiosk_idempotency_keys where idempotency_key = p_key;
$$ language sql stable;

create or replace function fa_kiosk_store_idempotency(p_key text, p_rpc_name text, p_result jsonb) returns void as $$
  insert into fa_kiosk_idempotency_keys (idempotency_key, rpc_name, result_json)
  values (p_key, p_rpc_name, p_result)
  on conflict (idempotency_key) do nothing;
$$ language sql volatile;
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
-- Fase 3: check-in via RPC, portando apps/kiosk/src/server/routes/checkin.ts
-- (packages/domain: loyalty-engine, visit-frequency, closing-time) para
-- plpgsql. SECURITY DEFINER: roda como dono da tabela, por isso consegue
-- escrever em sessions/visit_log/loyalty_rewards mesmo essas tabelas não
-- tendo policy de INSERT para o papel "authenticated" (RLS, migration 09).

-- Segredo estável do HMAC de pulseira/ticket — antes era uma chave
-- efêmera por processo (apps/kiosk/src/server/security/codes.ts), o que
-- não funciona mais com múltiplos dispositivos/reinícios. Gerada uma vez
-- aqui; nenhuma policy de SELECT libera esta tabela para "authenticated".
create table if not exists fa_kiosk_secrets (
  key text primary key,
  value text not null
);
insert into fa_kiosk_secrets (key, value)
values ('wristband_hmac_key', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;
alter table fa_kiosk_secrets enable row level security;

create or replace function fa_kiosk_hmac8(p_value text) returns text as $$
  select encode(hmac(p_value, (select value from fa_kiosk_secrets where key = 'wristband_hmac_key'), 'sha256'), 'hex')
$$ language sql stable security definer;

-- Retorna `date` (não `text`): fa_kiosk_sessions.business_date/fa_kiosk_orders.business_date
-- já existiam como `date` antes desta migração (criadas manualmente para o backoffice).
create or replace function fa_kiosk_business_date(p_now_ms bigint, p_cutoff_hour integer) returns date as $$
  select (to_timestamp((p_now_ms - p_cutoff_hour * 3600000) / 1000.0))::date
$$ language sql immutable;

-- Minutos até o horário de fechamento "HH:MM" configurado, ou null se não configurado.
create or replace function fa_kiosk_minutes_until_closing(p_now_ms bigint, p_closing_time text) returns integer as $$
declare
  parts text[];
  closing_ts timestamptz;
  now_ts timestamptz := to_timestamp(p_now_ms / 1000.0);
begin
  if p_closing_time is null or p_closing_time !~ '^\d{1,2}:\d{2}$' then
    return null;
  end if;
  parts := regexp_split_to_array(p_closing_time, ':');
  closing_ts := date_trunc('day', now_ts) + (parts[1] || ' hours')::interval + (parts[2] || ' minutes')::interval;
  return round(extract(epoch from (closing_ts - now_ts)) / 60);
end;
$$ language plpgsql stable;

create or replace function fa_kiosk_plan_duration_minutes(p_duration_value integer, p_duration_unit text) returns integer as $$
  select case when p_duration_unit = 'HORA' then p_duration_value * 60 else p_duration_value end
$$ language sql immutable;

-- Selo de frequência (packages/domain/loyalty/visit-frequency.ts): janela
-- de ~60 dias, limiares 3 (FREQUENTE) e 8 (VIP).
create or replace function fa_kiosk_visit_tier(p_child_id uuid, p_now_ms bigint) returns jsonb as $$
declare
  total_visits integer;
  recent_visits integer;
begin
  select count(*) into total_visits from fa_kiosk_visit_log where child_id = p_child_id;
  if total_visits = 0 then return null; end if;

  select count(*) into recent_visits from fa_kiosk_visit_log
    where child_id = p_child_id and (p_now_ms - at_ms) <= 60 * 24 * 60 * 60000;

  if recent_visits > 8 then
    return jsonb_build_object('tier', 'VIP', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('VIP — %s visitas', total_visits), 'blink', false);
  elsif recent_visits > 3 then
    return jsonb_build_object('tier', 'FREQUENTE', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('%s visitas', total_visits), 'blink', true);
  else
    return jsonb_build_object('tier', 'RECORRENTE', 'totalVisits', total_visits, 'recentVisits', recent_visits,
      'label', format('%s visita%s', total_visits, case when total_visits > 1 then 's' else '' end), 'blink', false);
  end if;
end;
$$ language plpgsql stable;

create or replace function fa_checkin(
  p_idempotency_key text,
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_asset_id uuid,
  p_guardian jsonb,
  p_child jsonb,
  p_coupon_code text,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_closing_time text;
  v_remaining integer;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_discount_cents integer := 0;
  v_session_id uuid := gen_random_uuid();
  v_short_id text := replace(v_session_id::text, '-', '');
  v_wristband text;
  v_ticket text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_visits_after integer;
  v_rule record;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
  if not found then raise exception 'PLANO_INVALIDO'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
    if v_remaining is not null and fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit) > v_remaining then
      raise exception 'FORA_DO_HORARIO: %', case when v_remaining > 0
        then format('Este plano não cabe até o fechamento (faltam %s min)', v_remaining)
        else 'O shopping já está fechando — não é possível iniciar novos planos' end;
    end if;
  end if;

  if p_activity = 'CARRINHO' then
    if p_asset_id is null then raise exception 'ASSET_OBRIGATORIO'; end if;
    update fa_kiosk_assets set status = 'EM_USO'
      where id = p_asset_id and status = 'DISPONIVEL';
    if not found then raise exception 'ASSET_INDISPONIVEL'; end if;
  end if;

  v_guardian_id := nullif(p_guardian->>'id', '')::uuid;
  if v_guardian_id is null and p_guardian->>'cpf' is not null then
    select id into v_guardian_id from fa_kiosk_guardians where cpf = p_guardian->>'cpf';
  end if;
  if v_guardian_id is null then
    select id into v_guardian_id from fa_kiosk_guardians where phone_e164 = p_guardian->>'phoneE164';
  end if;
  if v_guardian_id is null then
    insert into fa_kiosk_guardians (full_name, phone_e164, cpf)
      values (p_guardian->>'fullName', p_guardian->>'phoneE164', p_guardian->>'cpf')
      returning id into v_guardian_id;
  end if;

  v_child_id := nullif(p_child->>'id', '')::uuid;
  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, inclusive_proof_type)
      values (p_child->>'fullName', (p_child->>'birthDate')::date,
              coalesce((p_child->>'inclusiveEligible')::boolean, false), p_child->>'inclusiveProofType')
      returning id into v_child_id;
  end if;
  insert into fa_kiosk_child_guardians (child_id, guardian_id) values (v_child_id, v_guardian_id)
    on conflict (child_id, guardian_id) do nothing;

  if p_coupon_code is not null then
    select * into v_coupon from fa_kiosk_coupons
      where unit_id = p_unit_id and code = p_coupon_code and active for update;
    if not found then raise exception 'CUPOM_INVALIDO'; end if;
    update fa_kiosk_coupons set used_count = used_count + 1
      where id = v_coupon.id and (max_uses = 0 or used_count < max_uses);
    if not found then raise exception 'CUPOM_ESGOTADO'; end if;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_plan.value_cents * v_coupon.value / 100.0); end if;
  end if;

  v_wristband := format('FA1|W|%s|%s', v_short_id, fa_kiosk_hmac8(v_short_id));
  v_ticket := format('FA1|T|%s|%s', v_short_id, fa_kiosk_hmac8(v_short_id));

  insert into fa_kiosk_sessions (
    id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
    wristband_code, ticket_code, checkin_at_ms, checkin_by_employee_id,
    coupon_id, coupon_discount_cents, free_from_loyalty, business_date
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id, p_plan_id, v_child_id, p_child->>'fullName', v_guardian_id,
    v_wristband, v_ticket, v_now_ms, p_employee_id,
    v_coupon.id, v_coupon_discount_cents, false, fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour)
  );

  insert into fa_kiosk_visit_log (child_id, activity, at_ms) values (v_child_id, p_activity, v_now_ms);
  select count(*) into v_visits_after from fa_kiosk_visit_log where child_id = v_child_id;

  for v_rule in
    select * from fa_kiosk_loyalty_rules
    where unit_id = p_unit_id and active and (activity = p_activity or activity = 'AMBOS')
      and trigger_visits > 0 and v_visits_after % trigger_visits = 0
  loop
    insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms) values (v_child_id, v_rule.id, v_now_ms);
  end loop;

  v_cached := jsonb_build_object(
    'sessionId', v_session_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'wristbandCode', v_wristband, 'ticketCode', v_ticket,
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
-- Fase 3: checkout via RPC, portando apps/kiosk/src/server/routes/checkout.ts
-- + packages/domain/{time/session-timer,pricing/pricing-engine}.
--
-- Simplificação real habilitada pela migração: o design local tinha
-- tryMarkAwaitingPayment + revertToActive (compensação manual) porque o
-- processo Fastify não podia contar com uma transação real cobrindo tudo.
-- Aqui um `SELECT ... FOR UPDATE` + uma transação Postgres de verdade
-- bastam — qualquer `raise exception` no meio desfaz tudo sozinho.

create or replace function fa_kiosk_session_timing(p_plan record, p_checkin_at_ms bigint, p_now_ms bigint) returns jsonb as $$
declare
  elapsed_ms bigint := greatest(0, p_now_ms - p_checkin_at_ms);
  duration_ms bigint := fa_kiosk_plan_duration_minutes(p_plan.duration_value, p_plan.duration_unit) * 60000;
  over_ms bigint := greatest(0, elapsed_ms - duration_ms);
  over_minutes integer := ceil(over_ms / 60000.0);
  over_cents integer := over_minutes * p_plan.overage_cents_per_minute;
  live_total_cents integer := p_plan.value_cents + over_cents;
  phase text;
begin
  if over_minutes > 0 then phase := 'EXCEDENTE';
  elsif elapsed_ms < duration_ms * 0.8 then phase := 'VERDE';
  else phase := 'AMARELO';
  end if;
  return jsonb_build_object('elapsedMs', elapsed_ms, 'durationMs', duration_ms, 'overMinutes', over_minutes,
    'overCents', over_cents, 'liveTotalCents', live_total_cents, 'phase', phase);
end;
$$ language plpgsql immutable;

create or replace function fa_checkout(
  p_idempotency_key text,
  p_session_ids uuid[],
  p_payments jsonb, -- [{method, amountCents, nsu, authorization, pixTxid}] (chave JSON "authorization" -> coluna authorization_code)
  p_redeem_reward_ids uuid[],
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_session record;
  v_plan record;
  v_timing jsonb;
  v_total_cents integer := 0;
  v_payments_total integer := 0;
  v_unit_id uuid;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_payment jsonb;
  v_index integer := 0;
  v_first_session_id uuid;
  v_reward_id uuid;
  v_free_from_loyalty boolean;
  v_line_cents integer;
  v_applied_discount integer;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  for v_session in
    select * from fa_kiosk_sessions where id = any(p_session_ids) for update
  loop
    if v_session.status <> 'ATIVA' then
      raise exception 'SESSAO_JA_FECHADA: %', v_session.id;
    end if;
    if v_index = 0 then v_first_session_id := v_session.id; v_unit_id := v_session.unit_id; end if;

    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms);
    v_free_from_loyalty := (v_index = 0 and array_length(p_redeem_reward_ids, 1) > 0);

    v_line_cents := (v_timing->>'liveTotalCents')::integer;
    v_total_cents := v_total_cents + v_line_cents;

    if v_session.coupon_discount_cents > 0 then
      v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

    update fa_kiosk_sessions set status = 'AGUARDANDO_PAGAMENTO' where id = v_session.id;
    v_index := v_index + 1;
  end loop;

  if v_index <> array_length(p_session_ids, 1) then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_total_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_total_cents, v_payments_total;
  end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = v_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date)
    values (v_order_id, v_unit_id, v_shift.id, 'SESSAO', v_total_cents, 'ABERTA', v_shift.business_date);

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms);
    insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
      values (v_order_id, 'SESSAO', 'SERVICO', format('%s — %s', v_session.child_name_snapshot, v_plan.name), 1,
        v_plan.value_cents, v_plan.value_cents, v_plan.value_cents, v_session.id);
    if (v_timing->>'overMinutes')::integer > 0 then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
          (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    update fa_kiosk_sessions set status = 'FINALIZADA', checkout_at_ms = v_now_ms, order_id = v_order_id where id = v_session.id;
    if v_session.asset_id is not null then
      update fa_kiosk_assets set status = 'DISPONIVEL',
        odometer_minutes = odometer_minutes + ceil((v_now_ms - v_session.checkin_at_ms) / 60000.0)
        where id = v_session.asset_id;
    end if;
  end loop;

  foreach v_reward_id in array coalesce(p_redeem_reward_ids, array[]::uuid[]) loop
    update fa_kiosk_loyalty_rewards set redeemed_at_ms = v_now_ms, redeemed_session_id = v_first_session_id
      where id = v_reward_id and redeemed_at_ms is null;
  end loop;

  v_cached := jsonb_build_object('orderId', v_order_id, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkout', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
-- Fase 3: as duas mutações simples de sessão que sobraram em
-- apps/kiosk/src/server/routes/sessions.ts (notificar responsável, trocar
-- plano) — não são transacionais como check-in/checkout, mas gravam em
-- fa_kiosk_session_events, que é insert-only e sem policy de INSERT para
-- "authenticated" (migration 09), então precisam de uma função
-- SECURITY DEFINER também.

create or replace function fa_kiosk_log_session_event(p_session_id uuid, p_kind text, p_employee_id uuid, p_payload jsonb) returns void as $$
  insert into fa_kiosk_session_events (session_id, kind, at_ms, employee_id, payload_json)
  values (p_session_id, p_kind, (extract(epoch from now()) * 1000)::bigint, p_employee_id, p_payload)
$$ language sql security definer;

create or replace function fa_kiosk_change_session_plan(p_session_id uuid, p_plan_id uuid) returns void as $$
begin
  update fa_kiosk_sessions set plan_id = p_plan_id where id = p_session_id and status = 'ATIVA';
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;
  perform fa_kiosk_log_session_event(p_session_id, 'TROCA_PLANO', null, jsonb_build_object('newPlanId', p_plan_id));
end;
$$ language plpgsql security definer;
-- Fase 4: PDV e caixa via RPC, portando
-- apps/kiosk/src/server/routes/{shifts,pdv}.ts. `expected` continua
-- calculado só dentro de fa_close_shift(), sempre a partir dos pagamentos
-- reais gravados — nunca aceito do cliente. Isso preserva a propriedade
-- de segurança original independente da UI ser ou não "às cegas": quem
-- está sendo conferido nunca fornece o número contra o qual é conferido.

create or replace function fa_open_shift(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_opening_cash_cents integer
) returns jsonb as $$
declare
  v_cached jsonb;
  v_shift_id uuid := gen_random_uuid();
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_unit record;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  begin
    insert into fa_kiosk_shifts (id, unit_id, opened_by_employee_id, opened_at_ms, opening_cash_cents, business_date)
      values (v_shift_id, p_unit_id, p_employee_id, v_now_ms, p_opening_cash_cents,
              fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour));
  exception when unique_violation then
    raise exception 'TURNO_JA_ABERTO';
  end;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, employee_id, at_ms)
    values (v_shift_id, 'TROCO_INICIAL', p_opening_cash_cents, p_employee_id, v_now_ms);

  v_cached := jsonb_build_object('id', v_shift_id);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_open_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_record_cash_movement(
  p_idempotency_key text,
  p_shift_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_reason text,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, reason, employee_id, at_ms)
    values (p_shift_id, p_kind, p_amount_cents, p_reason, p_employee_id, (extract(epoch from now()) * 1000)::bigint);

  v_cached := jsonb_build_object('ok', true);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_record_cash_movement', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_close_shift(
  p_idempotency_key text,
  p_shift_id uuid,
  p_employee_id uuid,
  p_declared jsonb -- {"DINHEIRO": 12345, "PIX": 6789, ...}
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
  v_expected jsonb := '{}'::jsonb;
  v_divergence jsonb := '{}'::jsonb;
  v_cash_adjustments integer := 0;
  v_row record;
  v_method text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id for update;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  for v_row in
    select p.method, sum(p.amount_cents) as total_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id
    group by p.method
  loop
    v_expected := jsonb_set(v_expected, array[v_row.method], to_jsonb(v_row.total_cents));
  end loop;

  select coalesce(sum(case
      when kind in ('SUPRIMENTO', 'TROCO_INICIAL') then amount_cents
      when kind = 'SANGRIA' then -amount_cents
      else amount_cents -- AJUSTE pode ser positivo ou negativo
    end), 0) into v_cash_adjustments
  from fa_kiosk_cash_movements where shift_id = p_shift_id;

  v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(coalesce((v_expected->>'DINHEIRO')::integer, 0) + v_cash_adjustments));

  update fa_kiosk_shifts set status = 'FECHADO', closed_by_employee_id = p_employee_id,
    closed_at_ms = (extract(epoch from now()) * 1000)::bigint, declared_json = p_declared, expected_json = v_expected
    where id = p_shift_id;

  for v_method in select distinct key from (
    select jsonb_object_keys(v_expected) as key union select jsonb_object_keys(p_declared) as key
  ) k loop
    v_divergence := jsonb_set(v_divergence, array[v_method],
      to_jsonb(coalesce((p_declared->>v_method)::integer, 0) - coalesce((v_expected->>v_method)::integer, 0)));
  end loop;

  v_cached := jsonb_build_object('expected', v_expected, 'declared', p_declared, 'divergence', v_divergence);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_close_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

create or replace function fa_create_pdv_order(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_items jsonb, -- [{productId, quantity}]
  p_payments jsonb -- [{method, amountCents, ...}]
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product record;
  v_line_total integer;
  v_total_cents integer := 0;
  v_payments_total integer;
  v_payment jsonb;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = p_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from fa_kiosk_products where id = (v_item->>'productId')::uuid;
    if not found then raise exception 'PRODUTO_NAO_ENCONTRADO: %', v_item->>'productId'; end if;
    v_line_total := v_product.price_cents * (v_item->>'quantity')::integer;
    v_total_cents := v_total_cents + v_line_total;
  end loop;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_total_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_total_cents, v_payments_total;
  end if;

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date)
    values (v_order_id, p_unit_id, v_shift.id, 'PDV', v_total_cents, 'ABERTA', v_shift.business_date);

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from fa_kiosk_products where id = (v_item->>'productId')::uuid;
    update fa_kiosk_products set stock = stock - (v_item->>'quantity')::integer
      where id = v_product.id and stock >= (v_item->>'quantity')::integer;
    if not found then raise exception 'ESTOQUE_INSUFICIENTE: %', v_product.id; end if;

    insert into fa_kiosk_stock_movements (product_id, delta, reason, order_id, at_ms)
      values (v_product.id, -(v_item->>'quantity')::integer, 'PDV', v_order_id, v_now_ms);
    insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, product_id)
      values (v_order_id, 'PRODUTO', 'PRODUTO', v_product.name, (v_item->>'quantity')::integer,
        v_product.price_cents, v_product.price_cents, v_product.price_cents * (v_item->>'quantity')::integer, v_product.id);
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  v_cached := jsonb_build_object('orderId', v_order_id, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_create_pdv_order', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
-- Fase 5: ponto via RPC, portando apps/kiosk/src/server/routes/ponto.ts.
-- Sem endpoint de exclusão por desenho (Portaria MTP 671/2021) — e agora
-- reforçado por RLS (migration 09, sem policy de UPDATE/DELETE alguma
-- em fa_kiosk_ponto_records) e pelo NSR vir de uma sequence real do
-- Postgres (migration 06), garantindo sequência sem gaps mesmo com
-- múltiplos dispositivos registrando ponto ao mesmo tempo.

create or replace function fa_register_ponto(
  p_idempotency_key text,
  p_employee_id uuid,
  p_unit_id uuid,
  p_kind text,
  p_registered_by_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_id uuid := gen_random_uuid();
  v_nsr bigint;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  insert into fa_kiosk_ponto_records (id, employee_id, unit_id, kind, at_ms, registered_by_employee_id)
    values (v_id, p_employee_id, p_unit_id, p_kind, v_now_ms, p_registered_by_employee_id)
    returning nsr into v_nsr;

  v_cached := jsonb_build_object('id', v_id, 'nsr', v_nsr, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_register_ponto', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;
-- Fase 7: as duas consultas de apoio ao check-in que ainda restavam no
-- servidor local (autocomplete de criança, último carrinho usado) e o
-- total do dia — todas somente leitura, viram função por causa do
-- JOIN + OR + GROUP BY que o query builder do supabase-js não expressa bem.

create or replace function fa_kiosk_search_children(p_query text) returns table (
  id uuid, full_name text, birth_date date, phone_e164 text, guardian_name text, cpf text
) as $$
  select c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name as guardian_name, g.cpf
  from fa_kiosk_children c
  left join fa_kiosk_child_guardians cg on cg.child_id = c.id
  left join fa_kiosk_guardians g on g.id = cg.guardian_id
  where c.full_name ilike '%' || p_query || '%' or g.phone_e164 ilike '%' || p_query || '%'
     or g.cpf ilike '%' || p_query || '%' or g.full_name ilike '%' || p_query || '%'
  group by c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name, g.cpf
  order by c.full_name
  limit 10
$$ language sql stable;

create or replace function fa_kiosk_last_asset_for_child(p_child_id uuid) returns uuid as $$
  select asset_id from fa_kiosk_sessions
  where child_id = p_child_id and asset_id is not null
  order by checkin_at_ms desc limit 1
$$ language sql stable;

create or replace function fa_kiosk_today_revenue(p_unit_id uuid, p_business_date text) returns integer as $$
  select coalesce(sum(total_cents), 0)::integer from fa_kiosk_orders
  where unit_id = p_unit_id and business_date = p_business_date::date and status = 'PAGA'
$$ language sql stable;

-- Correção de RLS para fa_kiosk_app_settings e fa_kiosk_print_jobs
alter table fa_kiosk_app_settings enable row level security;
drop policy if exists fa_kiosk_app_settings_read on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_read_authenticated on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_read on fa_kiosk_app_settings for select using (true);

drop policy if exists fa_kiosk_app_settings_write on fa_kiosk_app_settings;
drop policy if exists fa_kiosk_write_manager on fa_kiosk_app_settings;
create policy fa_kiosk_app_settings_write on fa_kiosk_app_settings for all using (true) with check (true);

alter table fa_kiosk_print_jobs enable row level security;
drop policy if exists fa_kiosk_print_jobs_read on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_read on fa_kiosk_print_jobs for select using (true);

drop policy if exists fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_insert on fa_kiosk_print_jobs for insert with check (true);

drop policy if exists fa_kiosk_print_jobs_update on fa_kiosk_print_jobs;
create policy fa_kiosk_print_jobs_update on fa_kiosk_print_jobs for update using (true) with check (true);

-- Migração para suporte a dados importados do Safoplay e filtragem por origem
alter table fa_kiosk_orders add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_orders set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_orders_origin_date on fa_kiosk_orders (origin, business_date);

alter table fa_kiosk_sessions add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_sessions set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_sessions_origin_date on fa_kiosk_sessions (origin, business_date);

alter table fa_kiosk_visit_log add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_visit_log set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_visit_log_origin on fa_kiosk_visit_log (origin);

alter table fa_kiosk_guardians add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_guardians set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_guardians_origin on fa_kiosk_guardians (origin);

alter table fa_kiosk_children add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_children set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_children_origin on fa_kiosk_children (origin);

alter table fa_kiosk_payments add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_payments set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_payments_origin on fa_kiosk_payments (origin);


