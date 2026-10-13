-- Divergência no fechamento (Telegram/push/e-mail): além das formas com falta,
-- o corpo passa a trazer o Esperado e o Declarado de TODAS as formas de
-- pagamento ("Conferência <FORMA>: declarado X | esperado Y"). Regra de falta,
-- limiar e dedupe iguais aos de 20261010052328_fa_sobra_caixa_nao_e_divergencia.sql.
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
  v_conf text := '';
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
    order by 1
  loop
    v_declared := coalesce((v_shift.declared_json->>v_method)::bigint, 0);
    v_expected := coalesce((v_shift.expected_json->>v_method)::bigint, 0);
    v_diff := v_declared - v_expected;

    v_conf := v_conf || E'\nConferência ' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
      ' | esperado ' || fa_owner_report_money(v_expected);

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
    'Falta total: ' || fa_owner_report_money(v_total_shortage) || v_lines || v_conf,
    'DIVERGENCIA:' || p_shift_id::text
  );

  update fa_kiosk_owner_notifications
     set amount_cents = v_total_shortage
   where report_type = 'DIVERGENCIA_FECHAMENTO'
     and dedupe_key = 'DIVERGENCIA:' || p_shift_id::text
     and amount_cents is null;
end;
$function$;
