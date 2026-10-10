-- Regra de negócio: SOBRA de caixa não é divergência. Só FALTA/QUEBRA aciona
-- o alerta de divergência (Telegram/push) e conta no valor da divergência.
-- A sobra continua detalhada nos relatórios do Owner (abertura e fechamento),
-- apenas sem o rótulo de erro.
--
-- Reescreve, sobre as definições VIVAS na produção em 2026-10-10 (não sobre a
-- 20260914000001, que está defasada e não deve ser aplicada), quatro funções:
--   1. fa_owner_report_abertura_conciliacao  — sobra com 💡 em vez de ⚠️
--   2. fa_owner_report_build_divergencia_abertura — só quando há FALTA
--   3. fa_owner_report_build_divergencia — soma e notifica só faltas/quebra
--   4. fa_owner_report_build_fechamento — cabeçalho "falta total" (⚠️) ou, se
--      só há sobra, "💡 Informação de sobra" (sem rótulo de divergência)
-- Preservado das versões vivas: fonte do faturado (fa_kiosk_payments), visitas
-- por dia, meta ("% atingida"), gravação de amount_cents (limiar de divergência
-- do Telegram v2), limite mínimo de R$ 1,00, textos "sem justificativa".
-- Sinais: opening_divergence_cents e cash_break_cents < 0 = falta/quebra.

-- 1. Abertura: sobra deixa de ser marcada como alerta.
create or replace function public.fa_owner_report_abertura_conciliacao(p_shift_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_shift record;
begin
  select * into v_shift from fa_kiosk_shifts where id = p_shift_id;
  if v_shift.expected_opening_cash_cents is null then
    return E'\nFundo de Caixa contado na abertura: ' || fa_owner_report_money(v_shift.opening_cash_cents) ||
           E'\nFundo previsto: não registrado no fechamento anterior';
  end if;
  return E'\nFundo previsto (fechamento anterior): ' || fa_owner_report_money(v_shift.expected_opening_cash_cents) ||
         E'\nFundo de Caixa contado na abertura: ' || fa_owner_report_money(v_shift.opening_cash_cents) ||
         case
           when coalesce(v_shift.opening_divergence_cents, 0) = 0 then E'\n✓ Fundo conferido sem divergência'
           when v_shift.opening_divergence_cents > 0 then E'\n💡 SOBRA de ' || fa_owner_report_money(v_shift.opening_divergence_cents) || ' em relação ao fechamento anterior'
           else E'\n⚠️ FALTA de ' || fa_owner_report_money(abs(v_shift.opening_divergence_cents)) || ' em relação ao fechamento anterior'
         end;
end;
$function$;

-- 2. Divergência na abertura: só falta.
create or replace function public.fa_owner_report_build_divergencia_abertura(p_shift_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_shift record; v_unit record; v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;
  -- Sobra (>= 0) não é divergência.
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

  update fa_kiosk_owner_notifications
     set amount_cents = abs(v_shift.opening_divergence_cents)
   where report_type = 'DIVERGENCIA_ABERTURA'
     and dedupe_key = 'DIVERGENCIA_ABERTURA:' || p_shift_id::text
     and amount_cents is null;
end;
$function$;

-- 3. Divergência no fechamento: soma e lista só faltas e quebra de gaveta.
create or replace function public.fa_owner_report_build_divergencia(p_shift_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_shift record; v_unit record; v_method text;
  v_declared bigint; v_expected bigint; v_diff bigint;
  v_total_shortage bigint := 0; v_lines text := ''; v_justificativa text;
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
    -- Só falta (declarado < esperado) é divergência.
    if v_diff < 0 then
      v_total_shortage := v_total_shortage + abs(v_diff);
      v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
      v_lines := v_lines || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
        ' vs esperado ' || fa_owner_report_money(v_expected) || ' (falta de ' || fa_owner_report_money(abs(v_diff)) || ')' ||
        case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
    end if;
  end loop;

  if coalesce(v_shift.cash_break_cents, 0) < 0 then
    v_total_shortage := v_total_shortage + abs(v_shift.cash_break_cents);
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_lines := v_lines || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (quebra de ' || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
  end if;

  -- Ignora falta de centavos de arredondamento (< R$ 1,00 no total).
  if v_total_shortage < 100 then
    return;
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência no fechamento — ' || v_unit.name,
    'Falta total: ' || fa_owner_report_money(v_total_shortage) || v_lines,
    'DIVERGENCIA:' || p_shift_id::text
  );

  update fa_kiosk_owner_notifications
     set amount_cents = v_total_shortage
   where report_type = 'DIVERGENCIA_FECHAMENTO'
     and dedupe_key = 'DIVERGENCIA:' || p_shift_id::text
     and amount_cents is null;
end;
$function$;

-- 4. Fechamento: detalha faltas e sobras, mas só rotula como divergência a falta.
create or replace function public.fa_owner_report_build_fechamento(p_shift_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  v_visitas integer;
  v_daily_goal_cents bigint := 0;
  v_meta_pct numeric;
  v_meta_str text := '';
  v_method text;
  v_declared bigint;
  v_expected bigint;
  v_diff bigint;
  v_total_shortage bigint := 0;
  v_total_sobra bigint := 0;
  v_divergencia_str text := '';
  v_justificativa text;
  v_gaveta_str text := '';
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = coalesce(s.closed_by_employee_id, s.opened_by_employee_id)
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  select coalesce(sum(amount_cents), 0) into v_envelope_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null;

  select photo_url into v_envelope_photo_url
    from fa_kiosk_cash_movements
    where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null and photo_url is not null
    order by at_ms desc limit 1;

  select fundo_caixa_cents into v_fundo_legado_cents
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

  select count(*) into v_visitas
    from fa_kiosk_sessions
    where unit_id = v_shift.unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_shift.business_date;

  v_daily_goal_cents := fa_kiosk_daily_goal_cents(v_shift.unit_id, v_shift.business_date);

  if v_daily_goal_cents > 0 then
    v_meta_pct := round(((v_faturado_total_cents::numeric / v_daily_goal_cents::numeric) * 100), 1);
    v_meta_str := E'\nMeta do dia: ' || fa_owner_report_money(v_daily_goal_cents) ||
                  ' (' || v_meta_pct || '% atingida)';
  else
    v_meta_str := E'\nMeta do dia: Não definida';
  end if;

  if v_shift.counted_cash_cents is not null then
    v_gaveta_str :=
      E'\nFundo de Caixa inicial: ' || fa_owner_report_money(v_shift.opening_cash_cents) ||
      E'\nFaturamento em dinheiro: ' || fa_owner_report_money(v_dinheiro_cents) ||
      E'\nDinheiro contado na gaveta: ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' (esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) ||
      case
        when coalesce(v_shift.cash_break_cents, 0) = 0 then ', conferido)'
        when v_shift.cash_break_cents > 0 then ', SOBRA de ' || fa_owner_report_money(v_shift.cash_break_cents) || ')'
        else ', QUEBRA de ' || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')'
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
          v_total_shortage := v_total_shortage + abs(v_diff);
        else
          v_total_sobra := v_total_sobra + v_diff;
        end if;
        v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
        v_divergencia_str := v_divergencia_str || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
          ' vs esperado ' || fa_owner_report_money(v_expected) || ' (' ||
          (case when v_diff > 0 then 'sobra de ' else 'falta de ' end) || fa_owner_report_money(abs(v_diff)) || ')' ||
          case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
      end if;
    end loop;
  end if;

  if coalesce(v_shift.cash_break_cents, 0) <> 0 then
    if v_shift.cash_break_cents < 0 then
      v_total_shortage := v_total_shortage + abs(v_shift.cash_break_cents);
    else
      v_total_sobra := v_total_sobra + v_shift.cash_break_cents;
    end if;
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_divergencia_str := v_divergencia_str || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (' ||
      (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
  end if;

  -- Só falta >= R$ 1,00 vira "Divergência"; só sobra >= R$ 1,00 vira informação.
  if v_total_shortage >= 100 then
    v_divergencia_str := E'\n\n⚠️ Divergência no fechamento — falta total: ' || fa_owner_report_money(v_total_shortage) || v_divergencia_str;
  elsif v_total_sobra >= 100 then
    v_divergencia_str := E'\n\n💡 Informação de sobra no fechamento — sobra total: ' || fa_owner_report_money(v_total_sobra) || v_divergencia_str;
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
$function$;
