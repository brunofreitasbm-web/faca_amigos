-- Fecha a Fase 4 da distribuição multiplataforma: o lançamento diário de
-- bonificação/locações do Módulo FA (CaixaScreen.tsx, card "Bonificação
-- Diária & Locações") ainda ia para POST /api/caixa/bonificacao-diaria no
-- servidor Fastify local (apps/kiosk/src/server/routes/caixa-fa.ts), que
-- guarda tudo num `Map` em memória — some a cada reinício do app e não
-- existe fora daquele processo Electron. Portamos para o Supabase, no
-- mesmo padrão de fa_kiosk_cash_movements/fa_record_cash_movement: tabela
-- com RLS de SELECT apenas, escrita só via função SECURITY DEFINER.

create table if not exists fa_kiosk_daily_bonus (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  employee_id uuid not null references fa_kiosk_employees (id),
  business_date date not null,
  locacoes_count integer not null default 0,
  vendas_30m integer not null default 0,
  vendas_1h integer not null default 0,
  vendas_2h integer not null default 0,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  unique (unit_id, employee_id, business_date)
);
create index if not exists idx_fa_kiosk_daily_bonus_unit_date on fa_kiosk_daily_bonus (unit_id, business_date);

alter table fa_kiosk_daily_bonus enable row level security;
drop policy if exists fa_kiosk_read_authenticated on fa_kiosk_daily_bonus;
create policy fa_kiosk_read_authenticated on fa_kiosk_daily_bonus for select to authenticated using (true);
-- Nenhuma policy de insert/update/delete: só fa_kiosk_save_daily_bonus()
-- (SECURITY DEFINER) escreve, mesmo padrão das tabelas transacionais
-- (migration fa_kiosk_rls).

-- Um lançamento por funcionário/loja/dia: reenviar o formulário no mesmo
-- dia atualiza o mesmo registro em vez de duplicar (mesmo comportamento
-- que o `Map` em memória do servidor legado tinha via chave
-- `${empName}_${unitId}_${dateStr}`).
create or replace function fa_kiosk_save_daily_bonus(
  p_unit_id uuid,
  p_locacoes_count integer,
  p_vendas_30m integer,
  p_vendas_1h integer,
  p_vendas_2h integer,
  p_now_ms bigint
) returns fa_kiosk_daily_bonus as $$
declare
  v_employee_id uuid := fa_kiosk_current_employee_id();
  v_cutoff_hour integer;
  v_business_date date;
  v_row fa_kiosk_daily_bonus;
begin
  if v_employee_id is null then
    raise exception 'sessão de funcionário não encontrada' using errcode = '42501';
  end if;

  select business_day_cutoff_hour into v_cutoff_hour from fa_kiosk_units where id = p_unit_id;
  if v_cutoff_hour is null then
    raise exception 'unidade não encontrada' using errcode = '22023';
  end if;
  v_business_date := fa_kiosk_business_date(p_now_ms, v_cutoff_hour);

  insert into fa_kiosk_daily_bonus (
    unit_id, employee_id, business_date, locacoes_count, vendas_30m, vendas_1h, vendas_2h,
    created_at_ms, updated_at_ms
  ) values (
    p_unit_id, v_employee_id, v_business_date,
    coalesce(p_locacoes_count, 0), coalesce(p_vendas_30m, 0), coalesce(p_vendas_1h, 0), coalesce(p_vendas_2h, 0),
    p_now_ms, p_now_ms
  )
  on conflict (unit_id, employee_id, business_date) do update set
    locacoes_count = excluded.locacoes_count,
    vendas_30m = excluded.vendas_30m,
    vendas_1h = excluded.vendas_1h,
    vendas_2h = excluded.vendas_2h,
    updated_at_ms = excluded.updated_at_ms
  returning * into v_row;

  return v_row;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_save_daily_bonus(uuid, integer, integer, integer, integer, bigint) from public, anon;
grant execute on function fa_kiosk_save_daily_bonus(uuid, integer, integer, integer, integer, bigint) to authenticated;
