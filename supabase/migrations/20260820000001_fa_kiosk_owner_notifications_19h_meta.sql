-- =====================================================================
-- Notificações do Owner — Abertura, Visão Geral 19h (Meta, Faturamento, Sessões) e Fechamento (Meta, Faturamento, Sessões, Envelope)
-- Exclusivo para Owner (Role ADMIN via capacidade notificacoes.owner_push)
-- =====================================================================

-- 1. Atualiza constraint de fa_kiosk_owner_notifications para incluir ACOMPANHAMENTO_19H
alter table fa_kiosk_owner_notifications drop constraint if exists fa_kiosk_owner_notifications_report_type_check;
alter table fa_kiosk_owner_notifications add constraint fa_kiosk_owner_notifications_report_type_check
  check (report_type in (
    'ABERTURA', 'ACOMPANHAMENTO_17H', 'ACOMPANHAMENTO_19H', 'ACOMPANHAMENTO_20H', 'FECHAMENTO',
    'DIVERGENCIA_FECHAMENTO', 'RESUMO_SEMANAL', 'CANDIDATURA_TALENTOS',
    'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA'
  ));

-- 2. Atualiza a função de relatórios de acompanhamento para incluir a meta diária e porcentagem de atingimento
create or replace function fa_owner_report_build_acompanhamento(p_unit_id uuid, p_slot text) returns void as $$
declare
  v_unit record;
  v_business_date date;
  v_faturado_cents bigint;
  v_pedidos integer;
  v_visitas integer;
  v_ticket_cents bigint;
  v_daily_goal_cents bigint := 0;
  v_meta_pct numeric;
  v_meta_str text := '';
  v_report_type text := case p_slot
    when '17H' then 'ACOMPANHAMENTO_17H'
    when '19H' then 'ACOMPANHAMENTO_19H'
    when '20H' then 'ACOMPANHAMENTO_20H'
    else 'ACOMPANHAMENTO_19H'
  end;
begin
  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  v_business_date := (now() at time zone v_unit.timezone)::date;

  -- Faturamento acumulado do dia
  select coalesce(sum(total_cents), 0), count(*) into v_faturado_cents, v_pedidos
    from fa_kiosk_orders where unit_id = p_unit_id and business_date = v_business_date and status = 'PAGA';

  -- Quantidade de sessões/locações do dia
  select count(*) into v_visitas
    from fa_kiosk_sessions
    where unit_id = p_unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_business_date;

  -- Meta de faturamento diária configurada em fa_kiosk_app_settings
  select coalesce(value::bigint, 0) into v_daily_goal_cents
    from fa_kiosk_app_settings
    where unit_id = p_unit_id and key = 'daily_goal_cents';

  if v_daily_goal_cents > 0 then
    v_meta_pct := round(((v_faturado_cents::numeric / v_daily_goal_cents::numeric) * 100), 1);
    v_meta_str := E'\nMeta do dia: ' || fa_owner_report_money(v_daily_goal_cents) ||
                  ' (' || v_meta_pct || '% atingida)';
  else
    v_meta_str := E'\nMeta do dia: Não definida';
  end if;

  v_ticket_cents := case when v_pedidos > 0 then round(v_faturado_cents::numeric / v_pedidos) else 0 end;

  perform fa_owner_report_enqueue(
    p_unit_id, v_report_type, v_business_date,
    v_unit.emoji || ' Visão Geral ' || p_slot || ' — ' || v_unit.name,
    'Faturado até agora: ' || fa_owner_report_money(v_faturado_cents) ||
      v_meta_str ||
      E'\nSessões/locações: ' || v_visitas ||
      E'\nTicket médio: ' || fa_owner_report_money(v_ticket_cents)
  );
end;
$$ language plpgsql volatile security definer;

-- 3. Atualiza varredura periódica para incluir a janela das 19h (19:00 - 19:04:59)
create or replace function fa_owner_reports_run_acompanhamento() returns void as $$
declare
  v_unit record;
  v_local_time time;
begin
  for v_unit in select * from fa_kiosk_units loop
    v_local_time := (now() at time zone v_unit.timezone)::time;
    if v_local_time between '17:00' and '17:04:59' then
      perform fa_owner_report_build_acompanhamento(v_unit.id, '17H');
    elsif v_local_time between '19:00' and '19:04:59' then
      perform fa_owner_report_build_acompanhamento(v_unit.id, '19H');
    elsif v_local_time between '20:00' and '20:04:59' then
      perform fa_owner_report_build_acompanhamento(v_unit.id, '20H');
    end if;
  end loop;
end;
$$ language plpgsql volatile security definer;

-- 4. Atualiza o relatório de Fechamento com Meta diária e Quantidade de sessões/locações do dia
create or replace function fa_owner_report_build_fechamento(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
  v_envelope_cents bigint;
  v_fundo_cents bigint;
  v_dinheiro_cents bigint;
  v_credito_cents bigint;
  v_debito_cents bigint;
  v_pix_cents bigint;
  v_outros_cents bigint;
  v_faturado_total_cents bigint;
  v_visitas integer;
  v_daily_goal_cents bigint := 0;
  v_meta_pct numeric;
  v_meta_str text := '';
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = coalesce(s.closed_by_employee_id, s.opened_by_employee_id)
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  select coalesce(sum(amount_cents), 0) into v_envelope_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null;

  select fundo_caixa_cents into v_fundo_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and fundo_caixa_cents is not null
    order by at_ms desc limit 1;

  select
      coalesce(sum(p.amount_cents) filter (where p.method = 'DINHEIRO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'CREDITO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'DEBITO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'PIX'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method not in ('DINHEIRO', 'CREDITO', 'DEBITO', 'PIX')), 0)
    into v_dinheiro_cents, v_credito_cents, v_debito_cents, v_pix_cents, v_outros_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id and o.status = 'PAGA';

  v_faturado_total_cents := v_dinheiro_cents + v_credito_cents + v_debito_cents + v_pix_cents + v_outros_cents;

  -- Sessões/locações do dia
  select count(*) into v_visitas
    from fa_kiosk_sessions
    where unit_id = v_shift.unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_shift.business_date;

  -- Meta de faturamento diária em fa_kiosk_app_settings
  select coalesce(value::bigint, 0) into v_daily_goal_cents
    from fa_kiosk_app_settings
    where unit_id = v_shift.unit_id and key = 'daily_goal_cents';

  if v_daily_goal_cents > 0 then
    v_meta_pct := round(((v_faturado_total_cents::numeric / v_daily_goal_cents::numeric) * 100), 1);
    v_meta_str := E'\nMeta do dia: ' || fa_owner_report_money(v_daily_goal_cents) ||
                  ' (' || v_meta_pct || '% atingida)';
  else
    v_meta_str := E'\nMeta do dia: Não definida';
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' Fechamento ' || v_unit.name,
    v_operador || ' - Data: ' ||
      to_char(to_timestamp(v_shift.closed_at_ms / 1000.0) at time zone v_unit.timezone, 'DD/MM/YYYY, HH24:MI') ||
      E'\nValor Faturado: ' || fa_owner_report_money(v_faturado_total_cents) ||
      v_meta_str ||
      E'\nTotal de sessões/locações: ' || v_visitas ||
      E'\nFundo de Caixa: ' || fa_owner_report_money(coalesce(v_fundo_cents, v_shift.opening_cash_cents)) ||
      E'\nValor em Envelope: ' || fa_owner_report_money(v_envelope_cents) ||
      E'\nDetalhamento faturado — Dinheiro: ' || fa_owner_report_money(v_dinheiro_cents) ||
      ', Crédito: ' || fa_owner_report_money(v_credito_cents) ||
      ', Débito: ' || fa_owner_report_money(v_debito_cents) ||
      ', Pix: ' || fa_owner_report_money(v_pix_cents) ||
      case when v_outros_cents > 0 then ', Outros: ' || fa_owner_report_money(v_outros_cents) else '' end
  );
end;
$$ language plpgsql volatile security definer;
