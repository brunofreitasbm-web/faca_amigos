-- =====================================================================
-- Caixa: Fundo de Caixa do próximo dia no fechamento + conciliação na
-- abertura seguinte (com alerta ao Owner em caso de divergência)
-- =====================================================================
-- Regra de negócio (owner, 2026-09-02), conciliada com o que já existia:
--
--   FECHAMENTO (fa_close_shift)
--     Fundo_Caixa_Inicial      = fa_kiosk_shifts.opening_cash_cents (já
--                                existia; somente leitura no fechamento).
--     Faturamento_Dinheiro     = vendas em espécie do turno (expected_json
--                                ->'DINHEIRO', regra de 20260901100000).
--     Dinheiro_Total_Gaveta    = counted_cash_cents (contagem física do
--                                operador). O sistema calcula o valor
--                                esperado em drawer_expected_cents =
--                                fundo inicial + vendas em dinheiro
--                                + suprimentos/ajustes − sangrias avulsas,
--                                e a diferença vai para cash_break_cents
--                                (negativo = quebra, positivo = sobra).
--     Fundo_Caixa_Proximo_Dia  = next_day_float_cents (informado pelo
--                                operador no fechamento).
--     Valor no envelope        = envelope_cents = counted − next_day_float
--                                (CALCULADO, nunca digitado). O envelope
--                                físico continua sendo a SANGRIA com
--                                envelope_number + foto (fluxo "Registrar
--                                Envelope", 20260808070000) — o fechamento
--                                exige que esse envelope já tenha sido
--                                registrado com exatamente esse valor.
--
--   ABERTURA (fa_open_shift)
--     Fundo_Caixa_Abertura     = opening_cash_cents (contado pelo operador
--                                ao abrir; coluna já existia).
--     expected_opening_cash_cents = next_day_float_cents do último turno
--                                FECHADO da unidade (fallback legado: o
--                                fundo_caixa_cents anotado no envelope
--                                daquele turno, para fechamentos anteriores
--                                a esta migration).
--     opening_divergence_cents = opening_cash − expected_opening. Qualquer
--                                diferença gera alerta DIVERGENCIA_ABERTURA
--                                (push + e-mail) para o Owner e entra no
--                                relatório de Abertura.
--
-- Nada disso muda a conferência "às cegas" de declared_json x
-- expected_json: o esperado das vendas continua sendo calculado só no
-- servidor. A contagem da gaveta é uma segunda conferência, física.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas novas em fa_kiosk_shifts
-- ---------------------------------------------------------------------
-- Fechamento
alter table fa_kiosk_shifts add column if not exists counted_cash_cents integer;
alter table fa_kiosk_shifts add column if not exists drawer_expected_cents integer;
alter table fa_kiosk_shifts add column if not exists cash_break_cents integer;
alter table fa_kiosk_shifts add column if not exists next_day_float_cents integer;
alter table fa_kiosk_shifts add column if not exists envelope_cents integer;
-- Abertura
alter table fa_kiosk_shifts add column if not exists previous_shift_id uuid references fa_kiosk_shifts (id);
alter table fa_kiosk_shifts add column if not exists expected_opening_cash_cents integer;
alter table fa_kiosk_shifts add column if not exists opening_divergence_cents integer;

-- ---------------------------------------------------------------------
-- 2. Abertura: herda o fundo declarado no último fechamento e concilia
--    com o valor contado agora. Mesma assinatura de 20260806000013 —
--    CREATE OR REPLACE substitui no lugar, grants preservados.
-- ---------------------------------------------------------------------
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
  v_prev record;
  v_prev_id uuid;
  v_expected integer;
  v_divergence integer;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if p_opening_cash_cents is null or p_opening_cash_cents < 0 then
    raise exception 'FUNDO_ABERTURA_INVALIDO';
  end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  -- Último turno FECHADO da unidade: é dele que vem o Fundo_Caixa_Proximo_Dia.
  select id, next_day_float_cents into v_prev
    from fa_kiosk_shifts
    where unit_id = p_unit_id and status = 'FECHADO'
    order by closed_at_ms desc nulls last, opened_at_ms desc
    limit 1;

  if found then
    v_prev_id := v_prev.id;
    v_expected := v_prev.next_day_float_cents;
    if v_expected is null then
      -- Turno fechado antes desta migration: o único registro do "quanto
      -- fica na gaveta" era o fundo anotado no envelope de fechamento.
      select fundo_caixa_cents into v_expected
        from fa_kiosk_cash_movements
        where shift_id = v_prev.id and fundo_caixa_cents is not null
        order by at_ms desc limit 1;
    end if;
  end if;

  v_divergence := case when v_expected is null then null else p_opening_cash_cents - v_expected end;

  begin
    insert into fa_kiosk_shifts (
      id, unit_id, opened_by_employee_id, opened_at_ms, opening_cash_cents, business_date,
      previous_shift_id, expected_opening_cash_cents, opening_divergence_cents
    ) values (
      v_shift_id, p_unit_id, p_employee_id, v_now_ms, p_opening_cash_cents,
      fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour),
      v_prev_id, v_expected, v_divergence
    );
  exception when unique_violation then
    raise exception 'TURNO_JA_ABERTO';
  end;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, employee_id, at_ms)
    values (v_shift_id, 'TROCO_INICIAL', p_opening_cash_cents, p_employee_id, v_now_ms);

  v_cached := jsonb_build_object(
    'id', v_shift_id,
    'openingCashCents', p_opening_cash_cents,
    'expectedOpeningCashCents', v_expected,
    'openingDivergenceCents', v_divergence
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_open_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- 3. Fechamento: além do declarado por forma de pagamento (inalterado),
--    recebe a contagem física da gaveta e o fundo que fica para amanhã.
--    Parâmetros novos com default null: cliente antigo (ou chamada que
--    ficou na fila offline antes do deploy) continua funcionando e o
--    turno fecha sem os campos novos.
-- ---------------------------------------------------------------------
create or replace function fa_close_shift(
  p_idempotency_key text,
  p_shift_id uuid,
  p_employee_id uuid,
  p_declared jsonb, -- {"DINHEIRO": 12345, "PIX": 6789, ...}
  p_justifications jsonb default '{}'::jsonb, -- {"DINHEIRO": "...", "GAVETA": "..."}
  p_counted_cash_cents integer default null,   -- Dinheiro_Total_Gaveta (contado)
  p_next_day_float_cents integer default null  -- Fundo_Caixa_Proximo_Dia
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
  v_expected jsonb := '{}'::jsonb;
  v_divergence jsonb := '{}'::jsonb;
  v_row record;
  v_method text;
  v_cash_sales integer := 0;
  v_drawer_final integer := 0;
  v_drawer_expected integer;
  v_envelope integer;
  v_cash_break integer;
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

  -- DINHEIRO sempre presente no esperado (0 se não houve venda em espécie).
  if not (v_expected ? 'DINHEIRO') then
    v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(0));
  end if;
  v_cash_sales := coalesce((v_expected->>'DINHEIRO')::integer, 0);

  -- Conferência física da gaveta (só quando o cliente mandou a contagem).
  if p_counted_cash_cents is not null then
    if p_counted_cash_cents < 0 then
      raise exception 'DINHEIRO_CONTADO_INVALIDO';
    end if;
    if p_next_day_float_cents is null or p_next_day_float_cents < 0 then
      raise exception 'FUNDO_PROXIMO_DIA_INVALIDO';
    end if;
    if p_next_day_float_cents > p_counted_cash_cents then
      raise exception 'FUNDO_PROXIMO_DIA_MAIOR_QUE_CONTADO';
    end if;

    v_envelope := p_counted_cash_cents - p_next_day_float_cents;

    -- O envelope é a prova física da retirada: precisa existir como SANGRIA
    -- com número de envelope e o mesmo valor calculado aqui.
    if v_envelope > 0 and not exists (
      select 1 from fa_kiosk_cash_movements
      where shift_id = p_shift_id and kind = 'SANGRIA'
        and envelope_number is not null and amount_cents = v_envelope
    ) then
      raise exception 'ENVELOPE_NAO_REGISTRADO: registre o envelope de % centavos antes de fechar', v_envelope;
    end if;

    -- O que deveria estar na gaveta AGORA (depois do envelope sair):
    -- fundo inicial (TROCO_INICIAL) + vendas em dinheiro + suprimentos/
    -- ajustes − sangrias (avulsas e envelopes). Mesma conta de
    -- fa_units_cash_status.
    select coalesce(sum(case
        when kind in ('SUPRIMENTO', 'TROCO_INICIAL') then amount_cents
        when kind = 'SANGRIA' then -amount_cents
        else amount_cents
      end), 0) into v_drawer_final
    from fa_kiosk_cash_movements where shift_id = p_shift_id;
    v_drawer_final := v_drawer_final + v_cash_sales;

    -- Esperado no momento da contagem = gaveta final + envelope que saiu.
    v_drawer_expected := v_drawer_final + v_envelope;
    v_cash_break := p_counted_cash_cents - v_drawer_expected;
  end if;

  update fa_kiosk_shifts set status = 'FECHADO', closed_by_employee_id = p_employee_id,
    closed_at_ms = (extract(epoch from now()) * 1000)::bigint, declared_json = p_declared, expected_json = v_expected,
    close_justifications_json = p_justifications,
    counted_cash_cents = p_counted_cash_cents,
    drawer_expected_cents = v_drawer_expected,
    cash_break_cents = v_cash_break,
    next_day_float_cents = p_next_day_float_cents,
    envelope_cents = v_envelope
    where id = p_shift_id;

  for v_method in select distinct key from (
    select jsonb_object_keys(v_expected) as key union select jsonb_object_keys(p_declared) as key
  ) k loop
    v_divergence := jsonb_set(v_divergence, array[v_method],
      to_jsonb(coalesce((p_declared->>v_method)::integer, 0) - coalesce((v_expected->>v_method)::integer, 0)));
  end loop;

  v_cached := jsonb_build_object(
    'expected', v_expected, 'declared', p_declared, 'divergence', v_divergence, 'justifications', p_justifications,
    'countedCashCents', p_counted_cash_cents,
    'drawerExpectedCents', v_drawer_expected,
    'cashBreakCents', v_cash_break,
    'nextDayFloatCents', p_next_day_float_cents,
    'envelopeCents', v_envelope
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_close_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

-- Assinatura nova → grants precisam ser reemitidos (mesmo padrão de
-- 20260818000000 para fa_record_cash_movement); a de 5 parâmetros fica
-- órfã e é removida.
revoke execute on function fa_close_shift(text, uuid, uuid, jsonb, jsonb, integer, integer) from public, anon;
grant execute on function fa_close_shift(text, uuid, uuid, jsonb, jsonb, integer, integer) to authenticated;
drop function if exists fa_close_shift(text, uuid, uuid, jsonb, jsonb);

-- ---------------------------------------------------------------------
-- 4. Notificações do Owner — tipo novo DIVERGENCIA_ABERTURA
-- ---------------------------------------------------------------------
alter table fa_kiosk_owner_notifications drop constraint if exists fa_kiosk_owner_notifications_report_type_check;
alter table fa_kiosk_owner_notifications add constraint fa_kiosk_owner_notifications_report_type_check
  check (report_type in (
    'ABERTURA', 'ACOMPANHAMENTO_17H', 'ACOMPANHAMENTO_19H', 'ACOMPANHAMENTO_20H', 'FECHAMENTO',
    'DIVERGENCIA_FECHAMENTO', 'DIVERGENCIA_ABERTURA', 'RESUMO_SEMANAL', 'CANDIDATURA_TALENTOS',
    'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA'
  ));

-- Texto comum de "previsto x contado" usado no relatório de Abertura e no
-- alerta de divergência.
create or replace function fa_owner_report_abertura_conciliacao(p_shift_id uuid) returns text as $$
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
           when v_shift.opening_divergence_cents > 0 then E'\n⚠️ SOBRA de ' || fa_owner_report_money(v_shift.opening_divergence_cents) || ' em relação ao fechamento anterior'
           else E'\n⚠️ FALTA de ' || fa_owner_report_money(abs(v_shift.opening_divergence_cents)) || ' em relação ao fechamento anterior'
         end;
end;
$$ language plpgsql stable security definer;

-- 4a. Abertura — passa a mostrar previsto x contado.
create or replace function fa_owner_report_build_abertura(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'ABERTURA', v_shift.business_date,
    v_unit.emoji || ' Abertura ' || v_unit.name,
    v_operador || ' abriu o caixa às ' ||
      to_char(to_timestamp(v_shift.opened_at_ms / 1000.0) at time zone v_unit.timezone, 'HH24:MI') ||
      fa_owner_report_abertura_conciliacao(p_shift_id)
  );
end;
$$ language plpgsql volatile security definer;

-- 4b. Alerta separado de divergência na abertura — qualquer diferença
--     entre o que ficou declarado na gaveta e o que foi contado.
create or replace function fa_owner_report_build_divergencia_abertura(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;
  if v_shift.opening_divergence_cents is null or v_shift.opening_divergence_cents = 0 then
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

-- 4c. Divergência no fechamento — além do declarado x esperado por forma
--     de pagamento, inclui a quebra/sobra da contagem física da gaveta.
create or replace function fa_owner_report_build_divergencia(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_method text;
  v_declared bigint;
  v_expected bigint;
  v_diff bigint;
  v_total_abs_diff bigint := 0;
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
    if v_diff <> 0 then
      v_total_abs_diff := v_total_abs_diff + abs(v_diff);
      v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
      v_lines := v_lines || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
        ' vs esperado ' || fa_owner_report_money(v_expected) || ' (' ||
        (case when v_diff > 0 then 'sobra de ' else 'falta de ' end) || fa_owner_report_money(abs(v_diff)) || ')' ||
        case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
    end if;
  end loop;

  if coalesce(v_shift.cash_break_cents, 0) <> 0 then
    v_total_abs_diff := v_total_abs_diff + abs(v_shift.cash_break_cents);
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_lines := v_lines || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (' ||
      (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
  end if;

  -- Ignora diferença de centavos de arredondamento (< R$ 1,00 no total).
  if v_total_abs_diff < 100 then
    return;
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência no fechamento — ' || v_unit.name,
    'Diferença total: ' || fa_owner_report_money(v_total_abs_diff) || v_lines,
    'DIVERGENCIA:' || p_shift_id::text
  );
end;
$$ language plpgsql volatile security definer;

-- 4d. Fechamento — relatório passa a trazer os campos da regra:
--     fundo inicial, faturamento em dinheiro, dinheiro contado x esperado
--     (quebra/sobra), fundo para o próximo dia e valor em envelope.
--     Mantém foto do envelope (20260831150000), meta e divergência por
--     forma de pagamento (20260830000011).
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

  -- Fallback para turnos fechados por cliente antigo (sem next_day_float).
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

  -- Bloco da gaveta (regra nova). Se o turno fechou sem contagem (cliente
  -- antigo), cai no formato anterior: só "Fundo de Caixa".
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

  -- Divergência declarado x esperado por método — mesma regra de
  -- fa_owner_report_build_divergencia (ignora total < R$ 1,00).
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

  if coalesce(v_shift.cash_break_cents, 0) <> 0 then
    v_total_abs_diff := v_total_abs_diff + abs(v_shift.cash_break_cents);
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_divergencia_str := v_divergencia_str || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (' ||
      (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
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

-- 4e. Trigger de turno: na abertura também dispara o alerta de divergência.
create or replace function fa_owner_notify_on_shift_change() returns trigger as $$
begin
  if tg_op = 'INSERT' and new.status = 'ABERTO' then
    perform fa_owner_report_build_abertura(new.id);
    perform fa_owner_report_build_divergencia_abertura(new.id);
  elsif tg_op = 'UPDATE' and old.status <> 'FECHADO' and new.status = 'FECHADO' then
    perform fa_owner_report_build_fechamento(new.id);
    perform fa_owner_report_build_divergencia(new.id);
  end if;
  return new;
end;
$$ language plpgsql volatile security definer;

-- 4f. Canal de e-mail cobre o alerta novo (push já é genérico por tipo).
create or replace function fa_owner_email_claim_due(p_now_ms bigint) returns table (
  notification_id uuid, title text, body text, recipient_email text
) as $$
  with due as (
    update fa_kiosk_owner_notifications
    set emailed_at_ms = p_now_ms
    where emailed_at_ms is null
      and due_at_ms <= p_now_ms
      and report_type in ('ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_FECHAMENTO', 'DIVERGENCIA_ABERTURA')
    returning id, title, body
  )
  select d.id, d.title, d.body, e.email
  from due d
  cross join fa_kiosk_employees e
  where e.role = 'ADMIN' and e.email is not null and length(trim(e.email)) > 0;
$$ language sql volatile security definer;

revoke execute on function fa_owner_email_claim_due(bigint) from public;
grant execute on function fa_owner_email_claim_due(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 5. Auditoria do operador (20260818000004): registra os campos novos.
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_audit_shift_open_trg() returns trigger as $$
begin
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.opened_by_employee_id,
    'CAIXA_TURNO_ABERTO',
    case when coalesce(new.opening_divergence_cents, 0) <> 0 then 'ALERTA' else 'INFO' end,
    jsonb_build_object(
      'shiftId', new.id, 'unitId', new.unit_id,
      'openingCashCents', new.opening_cash_cents,
      'expectedOpeningCashCents', new.expected_opening_cash_cents,
      'openingDivergenceCents', new.opening_divergence_cents
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function fa_kiosk_audit_shift_close_trg() returns trigger as $$
begin
  if new.status is distinct from 'FECHADO' or old.status = 'FECHADO' then
    return new;
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.closed_by_employee_id,
    'CAIXA_TURNO_FECHADO',
    case when coalesce(new.cash_break_cents, 0) <> 0 then 'ALERTA' else 'INFO' end,
    jsonb_build_object(
      'shiftId', new.id, 'unitId', new.unit_id, 'declared', new.declared_json, 'expected', new.expected_json,
      'countedCashCents', new.counted_cash_cents,
      'drawerExpectedCents', new.drawer_expected_cents,
      'cashBreakCents', new.cash_break_cents,
      'nextDayFloatCents', new.next_day_float_cents,
      'envelopeCents', new.envelope_cents
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
