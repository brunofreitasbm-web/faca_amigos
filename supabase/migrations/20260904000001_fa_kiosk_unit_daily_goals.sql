-- Fase 2 da Bonificação Circuito/Playground (docs/bonificacao/programa-bonificacao-set-2026.md,
-- seção "Fase 2 de sistema"): "Meta do dia" deixa de ser um valor único por
-- unidade (fa_kiosk_app_settings.daily_goal_cents) e passa a variar por dia
-- da semana, porque domingo fatura 5-10x mais que segunda nas duas unidades
-- — uma meta plana ou é impossível de bater no meio da semana ou já vem
-- batida no fim de semana. Não confundir com as faixas meta/supermeta do
-- piloto de bonificação (apps/kiosk-ui/src/bonificacao.ts): aquele é um
-- placar de bônus em R$ por operador, calculado 100% no cliente por ora;
-- este é o alvo de faturamento simples que já existia (termômetro do
-- Painel e "Meta do dia" nos relatórios de 17h/19h/20h e no fechamento),
-- só ganhando granularidade por dia da semana. Os dois continuam
-- independentes.

create table if not exists fa_kiosk_unit_daily_goals (
  unit_id uuid not null references fa_kiosk_units (id),
  weekday smallint not null check (weekday between 1 and 7), -- isodow: 1=segunda ... 7=domingo
  goal_cents integer not null default 0 check (goal_cents >= 0),
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, weekday)
);

alter table fa_kiosk_unit_daily_goals enable row level security;

-- Leitura aberta a qualquer colaborador autenticado, mesmo padrão de
-- fa_kiosk_unit_ticket_goals (20260818000002): o termômetro do Painel
-- precisa da meta mesmo para quem não é Owner.
create policy fa_kiosk_unit_daily_goals_read on fa_kiosk_unit_daily_goals
  for select to authenticated using (true);

-- Escrita só quem já podia editar a meta diária antiga (config.write —
-- mesma capacidade do fa_kiosk_app_settings, ver 20260807000002), não uma
-- capacidade nova.
create policy fa_kiosk_unit_daily_goals_write on fa_kiosk_unit_daily_goals
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));

-- Meta do dia (em centavos) para uma unidade numa business_date: por dia da
-- semana quando configurada, com fallback para o valor único antigo em
-- fa_kiosk_app_settings.daily_goal_cents (unidade que ainda não foi
-- reconfigurada não perde a meta que já tinha). `stable`, sem
-- `security definer`: a policy de leitura acima já é aberta pra
-- authenticated, mesmo padrão de fa_kiosk_today_ticket_medio.
create or replace function fa_kiosk_daily_goal_cents(p_unit_id uuid, p_business_date date)
returns integer as $$
  select coalesce(
    (select goal_cents from fa_kiosk_unit_daily_goals
      where unit_id = p_unit_id and weekday = extract(isodow from p_business_date)::smallint),
    (select value::integer from fa_kiosk_app_settings
      where unit_id = p_unit_id and key = 'daily_goal_cents'),
    0
  )
$$ language sql stable;

-- Equivalente a fa_kiosk_today_revenue/fa_kiosk_today_ticket_medio
-- (20260806000015/20260818000002): RPC fina pro cliente ler só a meta de
-- hoje sem expor a tabela inteira nem recalcular isodow no navegador.
create or replace function fa_kiosk_today_goal_cents(p_unit_id uuid, p_business_date text)
returns integer as $$
  select fa_kiosk_daily_goal_cents(p_unit_id, p_business_date::date)
$$ language sql stable;

-- Os dois relatórios que hoje leem fa_kiosk_app_settings.daily_goal_cents
-- direto passam a usar fa_kiosk_daily_goal_cents(), que já inclui o
-- fallback pro valor antigo — troca só o trecho da meta, resto idêntico ao
-- que está em produção (conferido via pg_get_functiondef antes de escrever
-- esta migration).

create or replace function fa_owner_report_build_acompanhamento(p_unit_id uuid, p_slot text)
returns void as $$
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

  -- Meta de faturamento diária: por dia da semana (fa_kiosk_unit_daily_goals).
  v_daily_goal_cents := fa_kiosk_daily_goal_cents(p_unit_id, v_business_date);

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
$$ language plpgsql security definer;

create or replace function fa_owner_report_build_fechamento(p_shift_id uuid)
returns void as $$
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

  -- Meta de faturamento diária: por dia da semana (fa_kiosk_unit_daily_goals),
  -- na business_date do próprio turno (já resolvida com o corte de 4h).
  v_daily_goal_cents := fa_kiosk_daily_goal_cents(v_shift.unit_id, v_shift.business_date);

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
$$ language plpgsql security definer;
