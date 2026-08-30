-- fa_kiosk_close_payroll_run recebia hours_worked_minutes já calculado no
-- cliente (TS) e só gravava, sem nenhuma checagem — o único dado do
-- fechamento de folha que nunca era verificado no servidor. total_cents
-- continua vindo do cliente (salário-base + ajuste manual, revisado pelo
-- Owner na tela, sem fórmula automática a partir de horas), então isso não
-- muda o valor pago; mas "horas trabalhadas" é o dado que o Owner usa para
-- decidir o ajuste manual e para auditoria trabalhista — precisa refletir
-- fa_kiosk_ponto_records de verdade, não o que o navegador calculou.
--
-- fa_kiosk_compute_worked_minutes porta o mesmo algoritmo de
-- lib/ponto.ts::computeWorkedMinutes (pareamento cronológico
-- ENTRADA/SAÍDA/INTERVALO_INICIO/INTERVALO_FIM, com `incomplete` quando algo
-- fica sem par) para dentro do Postgres, para que o fechamento não dependa
-- de nenhum cálculo client-side.

create or replace function fa_kiosk_compute_worked_minutes(
  p_employee_id uuid,
  p_unit_id uuid,
  p_from_ms bigint,
  p_to_ms bigint
) returns table(minutes int, incomplete boolean) as $$
declare
  rec record;
  v_worked_ms bigint := 0;
  v_entrada_at bigint;
  v_intervalo_at bigint;
  v_incomplete boolean := false;
begin
  for rec in
    select r.kind, r.at_ms
      from fa_kiosk_ponto_records r
     where r.employee_id = p_employee_id
       and r.unit_id = p_unit_id
       and r.at_ms >= p_from_ms
       and r.at_ms < p_to_ms
     order by r.at_ms asc
  loop
    if rec.kind = 'ENTRADA' then
      if v_entrada_at is not null then v_incomplete := true; end if;
      v_entrada_at := rec.at_ms;
    elsif rec.kind = 'SAIDA' then
      if v_entrada_at is null then
        v_incomplete := true;
      else
        v_worked_ms := v_worked_ms + (rec.at_ms - v_entrada_at);
        v_entrada_at := null;
      end if;
    elsif rec.kind = 'INTERVALO_INICIO' then
      if v_intervalo_at is not null then v_incomplete := true; end if;
      v_intervalo_at := rec.at_ms;
    elsif rec.kind = 'INTERVALO_FIM' then
      if v_intervalo_at is null then
        v_incomplete := true;
      else
        v_worked_ms := v_worked_ms - (rec.at_ms - v_intervalo_at);
        v_intervalo_at := null;
      end if;
    end if;
  end loop;

  if v_entrada_at is not null or v_intervalo_at is not null then
    v_incomplete := true;
  end if;

  minutes := greatest(0, round(v_worked_ms / 60000.0)::int);
  incomplete := v_incomplete;
  return next;
end;
$$ language plpgsql stable;

-- Auditoria: agora que o servidor recalcula, também guardamos o sinal de
-- "incompleta" junto com as horas — mesma informação que já aparece como
-- "⚠️ Jornada incompleta" no Controle de Frequência.
alter table fa_kiosk_payroll_items add column if not exists hours_worked_incomplete boolean;

create or replace function fa_kiosk_close_payroll_run(
  p_unit_id uuid,
  p_year int,
  p_month int,
  p_items jsonb
) returns uuid as $$
declare
  v_run_id uuid;
  v_total_cents bigint;
  v_item jsonb;
  v_tz text;
  v_from_ms bigint;
  v_to_ms bigint;
  v_employee_id uuid;
  v_worked_minutes int;
  v_worked_incomplete boolean;
begin
  if not fa_kiosk_can('folha_pagamento.write') then
    raise exception 'sem permissão para fechar folha de pagamento' using errcode = '42501';
  end if;

  select coalesce(timezone, 'America/Belem') into v_tz from fa_kiosk_units where id = p_unit_id;
  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;
  v_from_ms := (extract(epoch from make_timestamptz(p_year, p_month, 1, 0, 0, 0, v_tz)) * 1000)::bigint;
  v_to_ms := (extract(epoch from make_timestamptz(p_year, p_month, 1, 0, 0, 0, v_tz) + interval '1 month') * 1000)::bigint;

  select coalesce(sum((elem->>'totalCents')::bigint), 0) into v_total_cents
    from jsonb_array_elements(p_items) elem;

  insert into fa_kiosk_payroll_runs (unit_id, year, month, closed_by_employee_id, total_cents)
  values (p_unit_id, p_year, p_month, fa_kiosk_current_employee_id(), v_total_cents)
  returning id into v_run_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_employee_id := nullif(v_item->>'employeeId', '')::uuid;
    v_worked_minutes := null;
    v_worked_incomplete := null;
    if v_employee_id is not null then
      select c.minutes, c.incomplete into v_worked_minutes, v_worked_incomplete
        from fa_kiosk_compute_worked_minutes(v_employee_id, p_unit_id, v_from_ms, v_to_ms) c;
    end if;

    insert into fa_kiosk_payroll_items (
      payroll_run_id, employee_id, full_name_snapshot, cpf_snapshot,
      bank_code_snapshot, bank_agencia_snapshot, bank_agencia_dv_snapshot,
      bank_conta_snapshot, bank_conta_dv_snapshot, bank_account_type_snapshot,
      salary_base_cents, adjustment_cents, adjustment_note, total_cents,
      hours_contracted, hours_worked_minutes, hours_worked_incomplete
    ) values (
      v_run_id,
      v_employee_id,
      v_item->>'fullName',
      v_item->>'cpf',
      v_item->>'bankCode',
      v_item->>'bankAgencia',
      v_item->>'bankAgenciaDv',
      v_item->>'bankConta',
      v_item->>'bankContaDv',
      v_item->>'bankAccountType',
      coalesce((v_item->>'salaryBaseCents')::int, 0),
      coalesce((v_item->>'adjustmentCents')::int, 0),
      v_item->>'adjustmentNote',
      coalesce((v_item->>'totalCents')::int, 0),
      nullif(v_item->>'hoursContracted', '')::numeric,
      v_worked_minutes,
      v_worked_incomplete
    );
  end loop;

  return v_run_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_close_payroll_run(uuid, int, int, jsonb) from public, anon;
grant execute on function fa_kiosk_close_payroll_run(uuid, int, int, jsonb) to authenticated;
