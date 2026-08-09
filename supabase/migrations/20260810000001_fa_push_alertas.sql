-- =====================================================================
-- Alerta em segundo plano (Web Push) — painel do responsável
-- =====================================================================
-- Até aqui, o "avisar 5 min antes"/"avisar no minuto da tabela" dependia
-- de manter a aba do ?acompanhar= aberta (setTimeout no cliente). Não
-- serve para o caso real de uso: o responsável está no shopping, não
-- olhando o celular. Esta migration monta a parte de servidor de um
-- alerta de verdade, entregue mesmo com o app fechado, via Web Push:
--   1. Tabela de inscrições (endpoint/chaves do navegador do responsável).
--   2. RPC pública para o cliente se inscrever (mesma porta estreita das
--      demais fa_acompanhar_*, ver 20260809000001).
--   3. Gêmeo SQL da régua de alerta do Circuito (copyCircuito.ts no
--      client) — necessário para calcular o instante do alerta no
--      servidor, sem depender do cliente ficar rodando.
--   4. RPC interna (service_role) que reivindica atomicamente as
--      inscrições vencidas — usada pela edge function que efetivamente
--      envia o push.
--   5. pg_cron disparando essa edge function a cada minuto via pg_net.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1. Inscrições de push
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references fa_kiosk_sessions (id),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  alert_due_at_ms bigint not null,
  sent_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (session_id, endpoint)
);
create index if not exists idx_fa_push_subs_pending on fa_kiosk_push_subscriptions (alert_due_at_ms) where sent_at_ms is null;

alter table fa_kiosk_push_subscriptions enable row level security;
-- Sem policy nenhuma: nem anon nem authenticated leem/escrevem a tabela
-- direto. Escrita só pela RPC SECURITY DEFINER abaixo; leitura/claim só
-- pela RPC interna do service_role (a edge function do cron).

-- ---------------------------------------------------------------------
-- 2. Gêmeo SQL da régua de alerta do Circuito
-- ---------------------------------------------------------------------
-- Espelha CIRCUITO_ALERTS em apps/kiosk-ui/src/screens/acompanhar/copyCircuito.ts
-- — se uma tabela nova for adicionada lá, precisa ser adicionada aqui
-- também (mesmo espírito do fa_kiosk_session_timing/computeSessionTiming).
create or replace function fa_circuito_alert_at_minutes(p_asset_kind text, p_duration_minutes integer) returns integer as $$
begin
  if p_asset_kind = 'CARRO' and p_duration_minutes = 15 then return 12; end if;
  if p_asset_kind = 'CARRO' and p_duration_minutes = 30 then return 25; end if;
  if p_asset_kind = 'PELUCIA' and p_duration_minutes = 10 then return 7; end if;
  if p_asset_kind = 'PELUCIA' and p_duration_minutes = 20 then return 16; end if;
  return null;
end;
$$ language plpgsql immutable;

-- ---------------------------------------------------------------------
-- 3. Inscrição pública (chamada pelo painel do responsável)
-- ---------------------------------------------------------------------
-- Calcula o instante do alerta no servidor (não confia no client) a
-- partir do mesmo plano usado por fa_acompanhar_por_codigo: Circuito usa
-- fa_circuito_alert_at_minutes; Playground usa a mesma janela de 5 min
-- antes do teto (fase VERMELHO) já usada em fa_kiosk_session_timing.
create or replace function fa_acompanhar_registrar_push(
  p_code text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
  v_duration_minutes integer;
  v_alert_minutes integer;
  v_alert_due_at_ms bigint;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    raise exception 'CODIGO_INVALIDO';
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code and status <> 'FINALIZADA';
  if not found then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;
  if v_s.uses_hour_bank then
    raise exception 'NAO_SUPORTADO';
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;
  v_duration_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);

  if v_s.activity = 'CARRINHO' then
    v_alert_minutes := fa_circuito_alert_at_minutes(v_plan.asset_kind, v_duration_minutes);
    if v_alert_minutes is null then
      raise exception 'NAO_SUPORTADO';
    end if;
  else
    v_alert_minutes := greatest(0, v_duration_minutes - 5);
  end if;

  v_alert_due_at_ms := v_s.checkin_at_ms + coalesce(v_s.paused_ms_total, 0) + (v_alert_minutes::bigint * 60000);

  insert into fa_kiosk_push_subscriptions (session_id, endpoint, p256dh, auth, alert_due_at_ms)
    values (v_s.id, p_endpoint, p_p256dh, p_auth, v_alert_due_at_ms)
    on conflict (session_id, endpoint) do update
      set alert_due_at_ms = excluded.alert_due_at_ms, sent_at_ms = null;

  perform fa_kiosk_log_session_event(v_s.id, 'PUSH_INSCRITO', null, jsonb_build_object('alertDueAtMs', v_alert_due_at_ms));

  return jsonb_build_object('status', 'OK', 'alertDueAtMs', v_alert_due_at_ms);
end;
$$ language plpgsql volatile security definer;

revoke execute on function fa_acompanhar_registrar_push(text, text, text, text) from public;
grant execute on function fa_acompanhar_registrar_push(text, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Reivindicação atômica das inscrições vencidas (só service_role)
-- ---------------------------------------------------------------------
-- UPDATE...RETURNING numa única declaração: se o cron sobrepuser duas
-- invocações (rede lenta, retry), a segunda não pega as mesmas linhas —
-- `sent_at_ms is null` já não bate mais para quem a primeira já marcou.
create or replace function fa_push_claim_due(p_now_ms bigint) returns table (
  endpoint text, p256dh text, auth text, access_code text, child_first_name text
) as $$
begin
  return query
  update fa_kiosk_push_subscriptions ps
  set sent_at_ms = p_now_ms
  from fa_kiosk_sessions s
  where ps.session_id = s.id
    and ps.sent_at_ms is null
    and ps.alert_due_at_ms <= p_now_ms
    and s.status <> 'FINALIZADA'
  returning ps.endpoint, ps.p256dh, ps.auth, s.access_code, split_part(s.child_name_snapshot, ' ', 1);
end;
$$ language plpgsql volatile security definer;

revoke execute on function fa_push_claim_due(bigint) from public;
grant execute on function fa_push_claim_due(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 5. Cron: dispara a edge function de envio a cada minuto
-- ---------------------------------------------------------------------
-- A função é pública (verify_jwt=false, mesmo padrão de login-pin/
-- list-employees neste projeto) porque ela não recebe nem devolve dados
-- de terceiros — só processa o que já está vencido no banco, e a
-- reivindicação em (4) é atômica. Chamar fora de hora não vaza nada,
-- só antecipa um envio.
do $$
begin
  perform cron.unschedule('fa-push-alert-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'fa-push-alert-dispatch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/push-alert-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
