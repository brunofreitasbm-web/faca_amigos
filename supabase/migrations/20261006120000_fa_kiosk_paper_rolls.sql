-- Métrica de consumo de bobina (módulo de gestão > Bobinas).
--
-- Cada cupom impresso (RECEIPT) já sai do gerador ESC/POS com uma
-- estimativa de comprimento em mm (`generateEscPosReceipt(...).estimatedLengthMm`,
-- ver packages/domain/src/printers/escpos.ts — linhas × 4,23mm + QR/avanço).
-- O print bridge (apps/kiosk) grava essa estimativa em
-- `fa_kiosk_print_jobs.paper_length_mm` e abate da bobina ATIVA da unidade
-- via `fa_kiosk_register_print_consumption`. Isso permite prever quando a
-- bobina de 30m vai acabar, sem nenhum sensor físico — é conta feita a
-- partir do que o app já manda pro papel.
alter table fa_kiosk_print_jobs add column if not exists paper_length_mm numeric;

create table if not exists fa_kiosk_paper_rolls (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  roll_length_mm integer not null default 30000,
  consumed_mm numeric not null default 0,
  status text not null check (status in ('ACTIVE', 'FINISHED')) default 'ACTIVE',
  installed_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  installed_by_employee_id uuid references fa_kiosk_employees (id),
  finished_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- No máximo 1 bobina ATIVA por unidade — é o que `fa_kiosk_register_print_consumption`
-- assume ao abater consumo ("a" bobina ativa da unidade).
create unique index if not exists idx_fa_kiosk_paper_rolls_one_active
  on fa_kiosk_paper_rolls (unit_id)
  where status = 'ACTIVE';

create index if not exists idx_fa_kiosk_paper_rolls_unit on fa_kiosk_paper_rolls (unit_id, created_at_ms desc);

alter table fa_kiosk_paper_rolls enable row level security;
drop policy if exists fa_kiosk_paper_rolls_read on fa_kiosk_paper_rolls;
create policy fa_kiosk_paper_rolls_read on fa_kiosk_paper_rolls for select to authenticated using (true);

-- Escrita (trocar bobina) só por GERENTE/ADMIN — mesma régua de
-- fa_kiosk_has_role usada nas telas de Gerencial (ver 20260806000009_fa_kiosk_rls.sql).
-- O consumo por impressão (`fa_kiosk_register_print_consumption`) é
-- SECURITY DEFINER e roda com a chave de serviço do print bridge, então
-- não depende desta policy.
drop policy if exists fa_kiosk_paper_rolls_write_manager on fa_kiosk_paper_rolls;
create policy fa_kiosk_paper_rolls_write_manager on fa_kiosk_paper_rolls
  for all to authenticated
  using (fa_kiosk_has_role('GERENTE'))
  with check (fa_kiosk_has_role('GERENTE'));

-- Chamada pelo print bridge (apps/kiosk/src/main/printBridge.ts, chave de
-- serviço) depois de CADA impressão de cupom bem-sucedida — nunca pela UI.
-- Cria a bobina ativa com o tamanho padrão (30m) na primeira chamada de
-- uma unidade, pra funcionar sem provisionamento manual prévio.
create or replace function fa_kiosk_register_print_consumption(
  p_unit_id uuid,
  p_length_mm numeric
) returns void as $$
declare
  v_updated integer;
begin
  if p_length_mm is null or p_length_mm <= 0 then return; end if;

  update fa_kiosk_paper_rolls
     set consumed_mm = consumed_mm + p_length_mm
   where unit_id = p_unit_id
     and status = 'ACTIVE';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    insert into fa_kiosk_paper_rolls (unit_id, consumed_mm, status, installed_at_ms)
    values (p_unit_id, p_length_mm, 'ACTIVE', (extract(epoch from now()) * 1000)::bigint)
    -- Corrida entre dois terminais da mesma unidade na primeira chamada:
    -- quem perder o conflito soma na bobina que o outro acabou de criar,
    -- em vez de falhar.
    on conflict (unit_id) where status = 'ACTIVE'
    do update set consumed_mm = fa_kiosk_paper_rolls.consumed_mm + excluded.consumed_mm;
  end if;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_register_print_consumption(uuid, numeric) from public;
revoke all on function fa_kiosk_register_print_consumption(uuid, numeric) from anon;
revoke all on function fa_kiosk_register_print_consumption(uuid, numeric) from authenticated;
grant execute on function fa_kiosk_register_print_consumption(uuid, numeric) to service_role;

-- Chamada pela UI (Gerencial > Bobinas, botão "Registrar troca de
-- bobina"). Fecha a bobina ativa (se houver) e abre uma nova com o
-- tamanho informado (padrão 30m — o que o dono normalmente compra).
create or replace function fa_kiosk_register_roll_change(
  p_unit_id uuid,
  p_roll_length_mm integer default 30000
) returns uuid as $$
declare
  v_new_id uuid;
begin
  if not fa_kiosk_has_role('GERENTE') then
    raise exception 'Sem permissão para trocar bobina.';
  end if;
  if p_roll_length_mm is null or p_roll_length_mm <= 0 then
    raise exception 'Tamanho de bobina inválido.';
  end if;

  update fa_kiosk_paper_rolls
     set status = 'FINISHED', finished_at_ms = (extract(epoch from now()) * 1000)::bigint
   where unit_id = p_unit_id
     and status = 'ACTIVE';

  insert into fa_kiosk_paper_rolls (unit_id, roll_length_mm, consumed_mm, status, installed_at_ms, installed_by_employee_id)
  values (p_unit_id, p_roll_length_mm, 0, 'ACTIVE', (extract(epoch from now()) * 1000)::bigint, fa_kiosk_current_employee_id())
  returning id into v_new_id;

  return v_new_id;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_register_roll_change(uuid, integer) from public;
revoke all on function fa_kiosk_register_roll_change(uuid, integer) from anon;
grant execute on function fa_kiosk_register_roll_change(uuid, integer) to authenticated;
