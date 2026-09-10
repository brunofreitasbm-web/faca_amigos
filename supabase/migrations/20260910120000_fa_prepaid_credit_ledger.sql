-- =====================================================================
-- Saldo pré-pago da criança — Ledger (Passo 1 / 8)
-- =====================================================================
-- Regra de negócio (decidida em 2026-09-10):
--
--   * Na Entrada, o operador pode vender um Plano/Pacote SEM iniciar a
--     sessão: o pai paga e vai embora, a criança volta outro dia para
--     usar. Isso é o caso minoritário — o padrão continua sendo iniciar
--     a contagem na hora.
--   * O saldo é da CRIANÇA, não do responsável (ao contrário de
--     fa_kiosk_guardian_packages, que já é compartilhado entre irmãos
--     via fa_kiosk_package_consume — não é isso que queremos aqui).
--   * O saldo NÃO VENCE — `expires_at_ms` fica sempre nulo. A coluna
--     existe só para não fechar a porta a uma validade futura sem ter
--     que migrar linhas depois.
--   * Não dá pra reaproveitar fa_kiosk_hour_bank_credits: lá
--     `source_session_id` é NOT NULL UNIQUE, e essa constraint é a
--     garantia anti-duplicação do banco de horas (fila offline / retry
--     de idempotência) — um crédito pré-pago não tem sessão de origem,
--     e afrouxar essa constraint enfraqueceria uma funcionalidade viva.
--     Por isso esta é uma tabela irmã, com o mesmo padrão.
--   * "Regra do Pacote/Plano correspondente" (fracionamento, tarifa de
--     excedente) fica congelada por snapshot no momento da venda —
--     igual ao que fa_kiosk_guardian_packages e fa_kiosk_hour_bank_credits
--     já fazem com o plano/pacote de origem.
--   * Débito é FIFO por ORDEM DE COMPRA (`purchased_at_ms asc`), não por
--     vencimento como o banco de horas — aqui nada vence, então a ordem
--     justa é "o que foi pago primeiro é usado primeiro".
--   * Colunas de cancelamento (`cancelled_at_ms` etc.) entram desde já,
--     mesmo sem tela de estorno: saldo sem validade é passivo contábil
--     permanente, e adicionar essas colunas depois com dinheiro real na
--     tabela seria bem pior.
--
-- Esta migration não muda nada visível: cria o ledger e as funções de
-- leitura/débito, mas nenhuma tela e nenhuma RPC de venda ainda o usa.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ledger de créditos pré-pagos
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_child_time_credits (
  id uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references fa_kiosk_units (id),
  child_id    uuid not null references fa_kiosk_children (id),
  -- Quem PAGOU (recibo, NFS-e, contato). Não é quem pode usar: o saldo é
  -- da criança, e nenhuma consulta de consumo passa por aqui.
  guardian_id uuid not null references fa_kiosk_guardians (id),
  order_id    uuid references fa_kiosk_orders (id),
  activity    text not null default 'PLAYGROUND' check (activity in ('PLAYGROUND', 'CARRINHO')),

  -- "Regra do Pacote/Plano correspondente", congelada. Exatamente uma origem.
  plan_id    uuid references fa_kiosk_plans (id),
  package_id uuid references fa_kiosk_packages (id),
  source_name_snapshot     text    not null,
  price_cents              integer not null,
  charged_cents            integer not null,
  overage_cents_per_minute integer not null default 0,
  -- Fracionamento herdado da origem: null = fraciona livre (Pacote); N =
  -- cada visita consome no mínimo N minutos (Plano avulso). Usado pelo
  -- fa_checkin quando a criança volta para consumir o saldo.
  min_consumption_minutes  integer,

  minutes_total     integer not null check (minutes_total > 0),
  remaining_minutes integer not null check (remaining_minutes >= 0),
  purchased_at_ms   bigint  not null,
  -- Decisão do dono: saldo pré-pago NÃO vence. Nullable para não fechar a
  -- porta a uma validade futura sem migrar linhas — null é o único valor
  -- que a venda grava hoje.
  expires_at_ms     bigint,

  -- Primeira sessão que consumiu este crédito (rastreio/relatório).
  first_session_id         uuid references fa_kiosk_sessions (id),
  cancelled_at_ms           bigint,
  cancelled_by_employee_id  uuid references fa_kiosk_employees (id),
  cancel_reason             text,

  constraint fa_kiosk_child_time_credits_origem
    check ((plan_id is null) <> (package_id is null))
);

create index if not exists idx_fa_kiosk_child_time_credits_child
  on fa_kiosk_child_time_credits (child_id, purchased_at_ms)
  where remaining_minutes > 0 and cancelled_at_ms is null;

create index if not exists idx_fa_kiosk_child_time_credits_unit
  on fa_kiosk_child_time_credits (unit_id, purchased_at_ms)
  where remaining_minutes > 0 and cancelled_at_ms is null;

alter table fa_kiosk_child_time_credits enable row level security;
drop policy if exists child_time_credits_read on fa_kiosk_child_time_credits;
create policy child_time_credits_read on fa_kiosk_child_time_credits
  for select to authenticated using (true);
-- Nenhuma policy de escrita: criar e debitar crédito são passos internos
-- de RPCs security definer, nunca uma escrita solta do app — mesmo
-- padrão de fa_kiosk_hour_bank_credits.


-- ---------------------------------------------------------------------
-- 2. Saldo agregado por criança (para os cards de Entrada/Painel)
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_child_credit_balance(p_child_ids uuid[])
returns table (child_id uuid, remaining_minutes integer, credits_count integer)
as $$
  select c.child_id, sum(c.remaining_minutes)::integer, count(*)::integer
    from fa_kiosk_child_time_credits c
   where c.child_id = any(coalesce(p_child_ids, array[]::uuid[]))
     and c.cancelled_at_ms is null
     and c.remaining_minutes > 0
   group by c.child_id
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_child_credit_balance(uuid[]) from public;
grant execute on function fa_kiosk_child_credit_balance(uuid[]) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. Débito FIFO por ordem de compra
-- ---------------------------------------------------------------------
-- Interno do fechamento (fa_checkout) — nunca uma chamada solta do app,
-- por isso revogado de `authenticated` logo abaixo. Mesma lógica de
-- fa_kiosk_hour_bank_consume / fa_kiosk_package_consume.
create or replace function fa_kiosk_child_credit_consume(
  p_child_id uuid, p_minutes integer, p_now_ms bigint
) returns integer as $$
declare
  v_left integer := greatest(0, coalesce(p_minutes, 0));
  v_covered integer := 0;
  v_take integer;
  v_c record;
begin
  if v_left = 0 or p_child_id is null then return 0; end if;
  for v_c in
    select * from fa_kiosk_child_time_credits
     where child_id = p_child_id and cancelled_at_ms is null and remaining_minutes > 0
     order by purchased_at_ms asc
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_c.remaining_minutes, v_left);
    update fa_kiosk_child_time_credits
       set remaining_minutes = remaining_minutes - v_take
     where id = v_c.id;
    v_left := v_left - v_take;
    v_covered := v_covered + v_take;
  end loop;
  return v_covered;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_child_credit_consume(uuid, integer, bigint) from public;
revoke execute on function fa_kiosk_child_credit_consume(uuid, integer, bigint) from authenticated;
grant execute on function fa_kiosk_child_credit_consume(uuid, integer, bigint) to service_role;


-- ---------------------------------------------------------------------
-- 4. Fila do Painel — "Saldos aguardando início"
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_child_credit_queue(p_unit_id uuid)
returns table (
  credit_id uuid, child_id uuid, child_name text, guardian_id uuid,
  guardian_name text, guardian_phone text, remaining_minutes integer,
  source_name_snapshot text, activity text, purchased_at_ms bigint,
  has_active_session boolean
) as $$
  select c.id, c.child_id, ch.full_name, c.guardian_id,
         g.full_name, g.phone_e164, c.remaining_minutes,
         c.source_name_snapshot, c.activity, c.purchased_at_ms,
         exists(
           select 1 from fa_kiosk_sessions s
            where s.child_id = c.child_id and s.status = 'ATIVA'
         )
    from fa_kiosk_child_time_credits c
    join fa_kiosk_children ch on ch.id = c.child_id
    join fa_kiosk_guardians g on g.id = c.guardian_id
   where c.unit_id = p_unit_id
     and c.cancelled_at_ms is null
     and c.remaining_minutes > 0
   order by c.purchased_at_ms asc
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_child_credit_queue(uuid) from public;
grant execute on function fa_kiosk_child_credit_queue(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. Capacidade nova — mesmo nível de pdv.sell (Operador já tem)
-- ---------------------------------------------------------------------
insert into fa_kiosk_role_capabilities (role, capability)
values ('OPERADOR', 'venda.prepago')
on conflict (role, capability) do nothing;
