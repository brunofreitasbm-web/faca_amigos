-- =====================================================================
-- Acompanhamento público via QR — painel do responsável
-- =====================================================================
-- A migration 20260807000003 fechou toda leitura anônima (revogou a
-- policy ampla `fa_kiosk_read_anon_temp` e o EXECUTE de anon/public em
-- bloco). Esta migration reabre exatamente UMA porta estreita: o
-- responsável que escaneou o QR da pulseira/recibo do próprio filho
-- pode consultar só o necessário para acompanhar o tempo — nunca dados
-- de outros responsáveis, pagamento ou outras crianças.
--
-- Duas funções, ambas SECURITY DEFINER, ambas exigindo o access_code
-- verificável por HMAC (mesmo mecanismo de fa_resolve_access_code):
--   fa_acompanhar_por_codigo   leitura: cronômetro, plano, status.
--   fa_acompanhar_evento       escrita: só os 3 tipos de evento desta
--                               feature, nunca INSERT livre na tabela.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Leitura pública do estado da sessão
-- ---------------------------------------------------------------------
-- Não devolve: guardian_id/nome/telefone, wristband_code/ticket_code,
-- dados de pagamento, nem sobrenome da criança (só o primeiro nome, no
-- mesmo espírito do card lúdico já usado no Painel interno).
--
-- Sessões de banco de horas (uses_hour_bank) ficam fora desta versão —
-- a lógica de saldo delas é "consumir de um pacote", não "cronômetro de
-- um plano avulso", e merece tratamento próprio depois. Devolve
-- NAO_SUPORTADO em vez de tentar aproximar os dois modelos.
create or replace function fa_acompanhar_por_codigo(p_code text) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code;
  if not found then
    return jsonb_build_object('status', 'NAO_ENCONTRADO');
  end if;

  if v_s.status = 'FINALIZADA' then
    return jsonb_build_object(
      'status', 'FINALIZADA',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
      'checkoutAtMs', v_s.checkout_at_ms
    );
  end if;

  if v_s.uses_hour_bank then
    return jsonb_build_object(
      'status', 'NAO_SUPORTADO',
      'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1)
    );
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;

  return jsonb_build_object(
    'status', case when v_s.paused_at_ms is not null then 'PAUSADA' else 'ATIVA' end,
    'sessionId', v_s.id,
    'childFirstName', split_part(v_s.child_name_snapshot, ' ', 1),
    'checkinAtMs', v_s.checkin_at_ms,
    'pausedAtMs', v_s.paused_at_ms,
    'pausedMsTotal', coalesce(v_s.paused_ms_total, 0),
    'sensoryTags', to_jsonb(coalesce(v_s.sensory_tags, array[]::text[])),
    'plan', jsonb_build_object(
      'durationValue', v_plan.duration_value,
      'durationUnit', v_plan.duration_unit,
      'valueCents', v_plan.value_cents,
      'overageCentsPerMinute', v_plan.overage_cents_per_minute
    )
  );
end;
$$ language plpgsql stable security definer;


-- ---------------------------------------------------------------------
-- 2. Escrita pública restrita a 3 tipos de evento
-- ---------------------------------------------------------------------
-- QR_ABERTO           registrado uma vez pelo client ao carregar o
--                      painel (não a cada poll — evita spam na tabela).
-- LEMBRETE_ATIVADO     responsável tocou em "avisar 5 min antes".
-- RENOVACAO_SOLICITADA responsável pediu +15/+30/+60 min; fica pendente
--                      até o operador aplicar pelo caixa (sem cobrança
--                      automática — não existe gateway de pagamento).
--
-- p_kind é validado aqui dentro, não confiado ao chamador: mesmo com
-- EXECUTE liberado para anon, não dá para gravar um `kind` arbitrário
-- na fa_kiosk_session_events.
create or replace function fa_acompanhar_evento(p_code text, p_kind text, p_payload jsonb default '{}'::jsonb) returns void as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
begin
  if p_kind not in ('QR_ABERTO', 'LEMBRETE_ATIVADO', 'RENOVACAO_SOLICITADA') then
    raise exception 'TIPO_EVENTO_INVALIDO';
  end if;

  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    raise exception 'CODIGO_INVALIDO';
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code and status <> 'FINALIZADA';
  if not found then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;

  perform fa_kiosk_log_session_event(v_s.id, p_kind, null, p_payload);
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 3. Permissões
-- ---------------------------------------------------------------------
-- Primeira concessão a `anon` desde o endurecimento de segurança da
-- 20260807000003 — deliberada e estreita: só estas duas funções, e cada
-- uma já valida o access_code por HMAC antes de tocar em qualquer linha
-- (1 em 1,1 trilhão de acerto por tentativa, mesmo mecanismo do
-- fa_resolve_access_code usado no balcão).
revoke execute on function fa_acompanhar_por_codigo(text) from public;
revoke execute on function fa_acompanhar_evento(text, text, jsonb) from public;
grant execute on function fa_acompanhar_por_codigo(text) to anon, authenticated, service_role;
grant execute on function fa_acompanhar_evento(text, text, jsonb) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. Fase VERMELHO no gêmeo SQL do motor de tempo
-- ---------------------------------------------------------------------
-- Mesma janela de packages/domain/src/time/session-timer.ts (últimos 5
-- minutos antes do teto do plano), só para o `phase` não divergir entre
-- o painel do responsável (client, via computeSessionTiming) e as telas
-- internas que chamam esta função (Painel/Caixa). O checkout ainda não
-- reage à cor VERMELHO — só evita que o texto da fase minta.
create or replace function fa_kiosk_session_timing(p_plan record, p_checkin_at_ms bigint, p_now_ms bigint) returns jsonb as $$
declare
  elapsed_ms bigint := greatest(0, p_now_ms - p_checkin_at_ms);
  duration_ms bigint := fa_kiosk_plan_duration_minutes(p_plan.duration_value, p_plan.duration_unit) * 60000;
  over_ms bigint := greatest(0, elapsed_ms - duration_ms);
  over_minutes integer := ceil(over_ms / 60000.0);
  over_cents integer := over_minutes * p_plan.overage_cents_per_minute;
  live_total_cents integer := p_plan.value_cents + over_cents;
  vermelho_window_ms constant bigint := 5 * 60000;
  phase text;
begin
  if over_minutes > 0 then phase := 'EXCEDENTE';
  elsif elapsed_ms < duration_ms * 0.8 then phase := 'VERDE';
  elsif elapsed_ms >= duration_ms - vermelho_window_ms then phase := 'VERMELHO';
  else phase := 'AMARELO';
  end if;
  return jsonb_build_object('elapsedMs', elapsed_ms, 'durationMs', duration_ms, 'overMinutes', over_minutes,
    'overCents', over_cents, 'liveTotalCents', live_total_cents, 'phase', phase);
end;
$$ language plpgsql immutable;
