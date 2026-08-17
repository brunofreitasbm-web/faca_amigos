-- =====================================================================
-- Rotinas de Notificação para o Owner — parte 2
-- =====================================================================
-- Estende 20260818000001_fa_kiosk_owner_reports.sql (mesma fila +
-- mesmo cron de despacho) com 5 relatórios novos, por evento em vez de
-- por horário fixo:
--   1. Divergência no fechamento — declared_json x expected_json do
--      turno não batem.
--   2. Resumo semanal — segunda de manhã, semana anterior x retrasada.
--   3. Candidatura no Banco de Talentos — nova ficha recebida.
--   4. Ocorrência de colaborador — atestado/falta lançado.
--   5. Avaliação Google negativa — nota baixa recebida pelo webhook.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Divergência no fechamento — declared_json/expected_json são
--    objetos planos por forma de pagamento (ver fa_close_shift em
--    20260818000000_...sql); close_justificativas_json é texto livre
--    por forma, sem vínculo numérico com o valor da diferença — então
--    "já justificado" aqui é só "tem texto", não "justifica o valor
--    certo". O Owner decide se a justificativa convence.
-- ---------------------------------------------------------------------
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

-- Redefine o trigger de turno (já criado em 20260818000001) para também
-- checar divergência no mesmo instante em que dispara o Fechamento —
-- mesma linha, mesmo evento, sem consulta extra ao shift.
create or replace function fa_owner_notify_on_shift_change() returns trigger as $$
begin
  if tg_op = 'INSERT' and new.status = 'ABERTO' then
    perform fa_owner_report_build_abertura(new.id);
  elsif tg_op = 'UPDATE' and old.status <> 'FECHADO' and new.status = 'FECHADO' then
    perform fa_owner_report_build_fechamento(new.id);
    perform fa_owner_report_build_divergencia(new.id);
  end if;
  return new;
end;
$$ language plpgsql volatile security definer;

-- ---------------------------------------------------------------------
-- 2. Resumo semanal — segunda de manhã (07:00-07:04 local da unidade),
--    compara a semana anterior (seg-dom que acabou de fechar) com a
--    retrasada. Mesmas fontes de fa_owner_report_build_acompanhamento
--    (fa_kiosk_orders/fa_kiosk_sessions), só que somando 7 dias.
-- ---------------------------------------------------------------------
create or replace function fa_owner_report_build_resumo_semanal(p_unit_id uuid) returns void as $$
declare
  v_unit record;
  v_hoje date;
  v_semana_fim date;
  v_semana_ini date;
  v_semana_ant_fim date;
  v_semana_ant_ini date;
  v_faturado_cents bigint;
  v_faturado_ant_cents bigint;
  v_visitas integer;
  v_visitas_ant integer;
  v_var_faturado numeric;
  v_var_visitas numeric;
begin
  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  v_hoje := (now() at time zone v_unit.timezone)::date;
  v_semana_fim := v_hoje - 1;         -- domingo que acabou de passar
  v_semana_ini := v_semana_fim - 6;   -- segunda daquela semana
  v_semana_ant_fim := v_semana_ini - 1;
  v_semana_ant_ini := v_semana_ant_fim - 6;

  select coalesce(sum(total_cents), 0) into v_faturado_cents
    from fa_kiosk_orders where unit_id = p_unit_id and business_date between v_semana_ini and v_semana_fim and status = 'PAGA';
  select coalesce(sum(total_cents), 0) into v_faturado_ant_cents
    from fa_kiosk_orders where unit_id = p_unit_id and business_date between v_semana_ant_ini and v_semana_ant_fim and status = 'PAGA';

  select count(*) into v_visitas
    from fa_kiosk_sessions where unit_id = p_unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date between v_semana_ini and v_semana_fim;
  select count(*) into v_visitas_ant
    from fa_kiosk_sessions where unit_id = p_unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date between v_semana_ant_ini and v_semana_ant_fim;

  v_var_faturado := case when v_faturado_ant_cents > 0 then round(((v_faturado_cents - v_faturado_ant_cents)::numeric / v_faturado_ant_cents) * 100, 1) else null end;
  v_var_visitas := case when v_visitas_ant > 0 then round(((v_visitas - v_visitas_ant)::numeric / v_visitas_ant) * 100, 1) else null end;

  perform fa_owner_report_enqueue(
    p_unit_id, 'RESUMO_SEMANAL', v_hoje,
    v_unit.emoji || ' Resumo semanal — ' || v_unit.name,
    'Semana ' || to_char(v_semana_ini, 'DD/MM') || ' a ' || to_char(v_semana_fim, 'DD/MM') ||
      E'\nFaturado: ' || fa_owner_report_money(v_faturado_cents) ||
      case when v_var_faturado is not null then ' (' || (case when v_var_faturado >= 0 then '+' else '' end) || v_var_faturado || '% vs semana anterior)' else '' end ||
      E'\nVisitas/locações: ' || v_visitas ||
      case when v_var_visitas is not null then ' (' || (case when v_var_visitas >= 0 then '+' else '' end) || v_var_visitas || '% vs semana anterior)' else '' end
  );
end;
$$ language plpgsql volatile security definer;

create or replace function fa_owner_reports_run_semanal() returns void as $$
declare
  v_unit record;
  v_local_ts timestamp;
begin
  for v_unit in select * from fa_kiosk_units loop
    v_local_ts := now() at time zone v_unit.timezone;
    if extract(isodow from v_local_ts) = 1 and v_local_ts::time between '07:00' and '07:04:59' then
      perform fa_owner_report_build_resumo_semanal(v_unit.id);
    end if;
  end loop;
end;
$$ language plpgsql volatile security definer;

do $$
begin
  perform cron.unschedule('fa-owner-report-semanal');
exception when others then null;
end $$;

select cron.schedule('fa-owner-report-semanal', '*/5 * * * *', $$ select fa_owner_reports_run_semanal(); $$);

-- ---------------------------------------------------------------------
-- 3. Candidatura no Banco de Talentos — só nasce via edge function
--    job-application-webhook (service_role), que ainda assim dispara
--    trigger normalmente. Sem unit_id (banco de talentos é único, não
--    por unidade) — fa_kiosk_owner_notifications já aceita unit_id nulo.
-- ---------------------------------------------------------------------
create or replace function fa_owner_notify_job_application() returns trigger as $$
begin
  perform fa_owner_report_enqueue(
    null, 'CANDIDATURA_TALENTOS', current_date,
    '🧑‍💼 Nova candidatura — Banco de Talentos',
    new.full_name || ' — ' || coalesce(new.desired_area, 'área não informada') || ' (' || new.opportunity_type || ')' ||
      E'\nContato: ' || coalesce(new.phone, new.email, '—'),
    'CANDIDATURA:' || new.id::text
  );
  return new;
end;
$$ language plpgsql volatile security definer;

drop trigger if exists trg_fa_owner_notify_job_application on fa_kiosk_job_applications;
create trigger trg_fa_owner_notify_job_application
  after insert on fa_kiosk_job_applications
  for each row execute function fa_owner_notify_job_application();

-- ---------------------------------------------------------------------
-- 4. Ocorrência de colaborador — nasce só via fa_kiosk_register_ocorrencia
--    (ver 20260817000005_fa_kiosk_ocorrencias.sql), que já confere
--    ocorrencias.write; o trigger só lê a linha já validada.
-- ---------------------------------------------------------------------
create or replace function fa_owner_notify_ocorrencia() returns trigger as $$
declare
  v_unit record;
  v_employee_name text;
begin
  select * into v_unit from fa_kiosk_units where id = new.unit_id;
  select name into v_employee_name from fa_kiosk_employees where id = new.employee_id;

  perform fa_owner_report_enqueue(
    new.unit_id, 'OCORRENCIA_COLABORADOR', current_date,
    v_unit.emoji || ' Ocorrência — ' || v_unit.name,
    coalesce(v_employee_name, 'Colaborador') || ': ' ||
      (case new.tipo when 'ATESTADO' then 'Atestado médico' else 'Falta' end) ||
      ' (' || new.days_away || ' dia' || (case when new.days_away <> 1 then 's' else '' end) || ')' ||
      case when new.notes is not null and length(trim(new.notes)) > 0 then E'\nObs: ' || new.notes else '' end,
    'OCORRENCIA:' || new.id::text
  );
  return new;
end;
$$ language plpgsql volatile security definer;

drop trigger if exists trg_fa_owner_notify_ocorrencia on fa_kiosk_ocorrencias;
create trigger trg_fa_owner_notify_ocorrencia
  after insert on fa_kiosk_ocorrencias
  for each row execute function fa_owner_notify_ocorrencia();

-- ---------------------------------------------------------------------
-- 5. Avaliação Google negativa — google-review-webhook hoje só grava
--    cupom de 5 estrelas, sem guardar nota nenhuma. Tabela nova para
--    registrar toda avaliação recebida (não só a negativa) — o webhook
--    passa a inserir aqui antes/junto da lógica de cupom (ver edição em
--    supabase/functions/google-review-webhook/index.ts). Sem policy:
--    escrita só pela edge function (service_role).
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_google_reviews (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references fa_kiosk_units (id),
  guardian_id uuid references fa_kiosk_guardians (id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table fa_kiosk_google_reviews enable row level security;

create or replace function fa_owner_notify_google_review_negativa() returns trigger as $$
declare
  v_unit record;
begin
  if new.rating > 3 then
    return new;
  end if;
  select * into v_unit from fa_kiosk_units where id = new.unit_id;

  perform fa_owner_report_enqueue(
    new.unit_id, 'AVALIACAO_NEGATIVA', current_date,
    '⭐ Avaliação Google baixa' || case when v_unit.name is not null then ' — ' || v_unit.name else '' end,
    'Nota: ' || new.rating || '/5' ||
      case when new.comment is not null and length(trim(new.comment)) > 0 then E'\nComentário: ' || new.comment else '' end,
    'AVALIACAO:' || new.id::text
  );
  return new;
end;
$$ language plpgsql volatile security definer;

drop trigger if exists trg_fa_owner_notify_google_review on fa_kiosk_google_reviews;
create trigger trg_fa_owner_notify_google_review
  after insert on fa_kiosk_google_reviews
  for each row execute function fa_owner_notify_google_review_negativa();
