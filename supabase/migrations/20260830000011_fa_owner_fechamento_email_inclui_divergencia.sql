-- =====================================================================
-- Divergência no texto do e-mail de Fechamento
-- =====================================================================
-- fa_owner_report_build_divergencia (20260818000002_...sql) já gera um
-- e-mail SEPARADO ("⚠️ Divergência no fechamento") quando declared_json
-- x expected_json não batem — confirmado rodando em produção e marcando
-- emailed_at_ms. Só que o Owner não está enxergando a divergência porque
-- ela nunca aparece no e-mail principal de Fechamento (só no separado) —
-- pedido do Owner foi trazer a divergência para dentro do mesmo e-mail
-- de Fechamento que ele já lê. Mantém o alerta separado como redundância
-- (não remove fa_owner_report_build_divergencia nem o trigger que chama
-- os dois).
-- =====================================================================

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
  v_method text;
  v_declared bigint;
  v_expected bigint;
  v_diff bigint;
  v_total_abs_diff bigint := 0;
  v_divergencia_str text := '';
  v_justificativa text;
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

  -- Divergência declarado x esperado por método — mesma regra de
  -- fa_owner_report_build_divergencia (ignora total < R$ 1,00), agora
  -- também dentro deste e-mail (não só no alerta separado).
  if v_shift.declared_json is not null and v_shift.expected_json is not null then
    for v_method in
      select distinct key from (
        select jsonb_object_keys(v_shift.declared_json) as key
        union
        select jsonb_object_keys(v_shift.expected_json) as key
      ) k
    loop
      v_declared := coalesce((v_shift.declared_json->>v_method)::bigint, 0);
      v_expected := coalesce((v_shift.expected_json->>v_method)::bigint, 0);
      v_diff := v_declared - v_expected;
      if v_diff <> 0 then
        v_total_abs_diff := v_total_abs_diff + abs(v_diff);
        v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
        v_divergencia_str := v_divergencia_str || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
          ' vs esperado ' || fa_owner_report_money(v_expected) || ' (' ||
          (case when v_diff > 0 then 'sobra de ' else 'falta de ' end) || fa_owner_report_money(abs(v_diff)) || ')' ||
          case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
      end if;
    end loop;
  end if;

  if v_total_abs_diff >= 100 then
    v_divergencia_str := E'\n\n⚠️ Divergência no fechamento — diferença total: ' || fa_owner_report_money(v_total_abs_diff) || v_divergencia_str;
  else
    v_divergencia_str := '';
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
      case when v_outros_cents > 0 then ', Outros: ' || fa_owner_report_money(v_outros_cents) else '' end ||
      v_divergencia_str
  );
end;
$$ language plpgsql volatile security definer;
