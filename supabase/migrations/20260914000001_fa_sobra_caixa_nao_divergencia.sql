-- Migration: 20260914000001_fa_sobra_caixa_nao_divergencia.sql
-- Regra de negócio: Sobras de caixa na abertura ou no fechamento não acionam
-- notificações de DIVERGENCIA nem são tratadas como erro de divergência.
-- Permanece a gravação dos valores reais e detalhamento da sobra nos relatórios do Owner.

-- 1. Alerta de divergência na abertura — apenas quando houver FALTA (diferença negativa)
create or replace function fa_owner_report_build_divergencia_abertura(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;

  -- Se não houve diferença ou se a diferença for SOBRA (opening_divergence_cents > 0), ignora alerta de divergência
  if v_shift.opening_divergence_cents is null or v_shift.opening_divergence_cents >= 0 then
    return;
  end if;

  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_ABERTURA', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência na abertura — ' || v_unit.name,
    v_operador || ' abriu o caixa às ' ||
      to_char(to_timestamp(v_shift.opened_at_ms / 1000.0) at time zone v_unit.timezone, 'HH24:MI') ||
      fa_owner_report_abertura_conciliacao(p_shift_id),
    'DIVERGENCIA_ABERTURA:' || p_shift_id::text
  );
end;
$$ language plpgsql volatile security definer;

-- 2. Divergência no fechamento — apenas dispara notificação de DIVERGENCIA_FECHAMENTO se houver FALTA
create or replace function fa_owner_report_build_divergencia(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_method text;
  v_declared bigint;
  v_expected bigint;
  v_diff bigint;
  v_total_shortage_diff bigint := 0;
  v_lines text := '';
  v_justificativa text;
begin
  select * into v_shift from fa_kiosk_shifts where id = p_shift_id;
  if v_shift.declared_json is null or v_shift.expected_json is null then
    return;
  end if;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;

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
    -- Apenas diferenças de falta (declarado < esperado) contam como divergência a notificar
    if v_diff < 0 then
      v_total_shortage_diff := v_total_shortage_diff + abs(v_diff);
      v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
      v_lines := v_lines || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
        ' vs esperado ' || fa_owner_report_money(v_expected) || ' (falta de ' || fa_owner_report_money(abs(v_diff)) || ')' ||
        case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
    end if;
  end loop;

  if coalesce(v_shift.cash_break_cents, 0) < 0 then
    v_total_shortage_diff := v_total_shortage_diff + abs(v_shift.cash_break_cents);
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_lines := v_lines || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (quebra de ' || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
  end if;

  -- Se não houve falta relevante (>= R$ 1,00), não dispara relatório de DIVERGENCIA_FECHAMENTO
  if v_total_shortage_diff < 100 then
    return;
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência no fechamento — ' || v_unit.name,
    'Falta total: ' || fa_owner_report_money(v_total_shortage_diff) || v_lines,
    'DIVERGENCIA:' || p_shift_id::text
  );
end;
$$ language plpgsql volatile security definer;

-- 3. Fechamento — relatório detalha faltas e sobras, mas rotula como divergência apenas se houver falta
create or replace function fa_owner_report_build_fechamento(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
  v_envelope_cents bigint;
  v_envelope_photo_url text;
  v_fundo_legado_cents bigint;
  v_dinheiro_cents bigint;
  v_credito_cents bigint;
  v_debito_cents bigint;
  v_pix_cents bigint;
  v_outros_cents bigint;
  v_faturado_total_cents bigint;
  v_visitas bigint;
  v_meta_cents bigint;
  v_meta_str text := '';
  v_gaveta_str text := '';
  v_divergencia_str text := '';
  v_method text;
  v_declared bigint;
  v_expected bigint;
  v_diff bigint;
  v_total_shortage_diff bigint := 0;
  v_total_sobra_diff bigint := 0;
  v_justificativa text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.closed_by_employee_id
    where s.id = p_shift_id;
  if v_shift.id is null or v_shift.status <> 'FECHADO' then
    return;
  end if;

  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  select coalesce(sum(amount_cents), 0) into v_envelope_cents
    from fa_kiosk_cash_movements
   where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null;

  select photo_url into v_envelope_photo_url
    from fa_kiosk_cash_movements
   where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null and photo_url is not null
   order column_id desc limit 1;

  select amount_cents into v_fundo_legado_cents
    from fa_kiosk_cash_movements
   where shift_id = p_shift_id and kind = 'TROCO_INICIAL'
   limit 1;

  v_dinheiro_cents := coalesce((v_shift.expected_json->>'DINHEIRO')::bigint, 0);
  v_credito_cents := coalesce((v_shift.expected_json->>'CREDITO')::bigint, 0);
  v_debito_cents := coalesce((v_shift.expected_json->>'DEBITO')::bigint, 0);
  v_pix_cents := coalesce((v_shift.expected_json->>'PIX')::bigint, 0);

  select coalesce(sum(amount_cents), 0) into v_outros_cents
    from (
      select (value)::bigint as amount_cents, key
        from jsonb_each_text(coalesce(v_shift.expected_json, '{}'::jsonb))
       where key not in ('DINHEIRO', 'CREDITO', 'DEBITO', 'PIX')
    ) sub;

  v_faturado_total_cents := v_dinheiro_cents + v_credito_cents + v_debito_cents + v_pix_cents + v_outros_cents;

  select count(*) into v_visitas
    from fa_kiosk_sessions
   where unit_id = v_shift.unit_id
     and checkin_at_ms >= v_shift.opened_at_ms
     and checkin_at_ms <= v_shift.closed_at_ms;

  select daily_goal_cents into v_meta_cents
    from fa_kiosk_unit_daily_goals
   where unit_id = v_shift.unit_id and business_date = v_shift.business_date;

  if v_meta_cents is not null and v_meta_cents > 0 then
    v_meta_str := E'\nMeta do Dia: ' || fa_owner_report_money(v_meta_cents) ||
      case when v_faturado_total_cents >= v_meta_cents
           then ' (🎯 META BATEDA! ' || fa_owner_report_money(v_faturado_total_cents - v_meta_cents) || ' acima)'
           else ' (faltou ' || fa_owner_report_money(v_meta_cents - v_faturado_total_cents) || ')' end;
  end if;

  if v_shift.counted_cash_cents is not null then
    v_gaveta_str :=
      E'\nFundo de Caixa Inicial (abertura): ' || fa_owner_report_money(v_shift.opening_cash_cents) ||
      E'\nDinheiro total contado na gaveta: ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      E'\nEsperado na gaveta: ' || fa_owner_report_money(v_shift.drawer_expected_cents) ||
      case when coalesce(v_shift.cash_break_cents, 0) <> 0 then
        ' (' || (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) ||
        fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')'
      else ' (sem diferença)'
      end ||
      E'\nFundo de Caixa para o próximo dia: ' || fa_owner_report_money(v_shift.next_day_float_cents) ||
      E'\nValor em Envelope: ' || fa_owner_report_money(v_envelope_cents);
  else
    v_gaveta_str :=
      E'\nFundo de Caixa: ' || fa_owner_report_money(coalesce(v_fundo_legado_cents, v_shift.opening_cash_cents)) ||
      E'\nValor em Envelope: ' || fa_owner_report_money(v_envelope_cents);
  end if;

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
        if v_diff < 0 then
          v_total_shortage_diff := v_total_shortage_diff + abs(v_diff);
        else
          v_total_sobra_diff := v_total_sobra_diff + v_diff;
        end if;
        v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
        v_divergencia_str := v_divergencia_str || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
          ' vs esperado ' || fa_owner_report_money(v_expected) || ' (' ||
          (case when v_diff > 0 then 'sobra de ' else 'falta de ' end) || fa_owner_report_money(abs(v_diff)) || ')' ||
          case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else '' end;
      end if;
    end loop;
  end if;

  if coalesce(v_shift.cash_break_cents, 0) <> 0 then
    if v_shift.cash_break_cents < 0 then
      v_total_shortage_diff := v_total_shortage_diff + abs(v_shift.cash_break_cents);
    else
      v_total_sobra_diff := v_total_sobra_diff + v_shift.cash_break_cents;
    end if;
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_divergencia_str := v_divergencia_str || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (' ||
      (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else '' end;
  end if;

  -- Só rotula como "⚠️ Divergência no fechamento" se houver falta >= R$ 1,00
  if v_total_shortage_diff >= 100 then
    v_divergencia_str := E'\n\n⚠️ Divergência no fechamento — falta total: ' || fa_owner_report_money(v_total_shortage_diff) || v_divergencia_str;
  elsif v_total_sobra_diff >= 100 then
    v_divergencia_str := E'\n\n💡 Informação de sobra no fechamento — sobra total: ' || fa_owner_report_money(v_total_sobra_diff) || v_divergencia_str;
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
      v_gaveta_str ||
      E'\nDetalhamento faturado — Dinheiro: ' || fa_owner_report_money(v_dinheiro_cents) ||
      ', Crédito: ' || fa_owner_report_money(v_credito_cents) ||
      ', Débito: ' || fa_owner_report_money(v_debito_cents) ||
      ', Pix: ' || fa_owner_report_money(v_pix_cents) ||
      case when v_outros_cents > 0 then ', Outros: ' || fa_owner_report_money(v_outros_cents) else '' end ||
      v_divergencia_str,
    p_photo_url := v_envelope_photo_url
  );
end;
$$ language plpgsql volatile security definer;
