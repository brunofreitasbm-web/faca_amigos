-- Campanha de opt-in: ritmo em rampa para cobrir a fila (visitas dos últimos
-- 90 dias) em até deadline_days (15) dias, em vez do teto fixo de 20/dia.
--
-- Na API oficial (Twilio -> Meta) o que protege o número é a nota de
-- qualidade (bloqueios, denúncias, PARAR) e o limite do tier (250 conversas
-- iniciadas pela empresa/24h no início), não o horário dos envios. Por isso:
--   - daily_cap sobe para no máx. 150: abaixo do tier, com folga para NPS,
--     avisos de visita e renovação, que saem pelo mesmo número;
--   - a meta do dia começa em 30 e só sobe se o último dia teve PARAR < 1,5%
--     (Edge Function crm-optin-dispatch, pacing.ts), e o freio automático de
--     3% PARAR / 20% falhas continua valendo;
--   - envios espalhados das 8h às 20h, rodadas a cada 5 min com 0-2 envios
--     sorteados, para o freio enxergar uma reação ruim depois de poucos envios.

alter table fa_crm_optin_config drop constraint if exists fa_crm_optin_config_daily_cap_check;
alter table fa_crm_optin_config add constraint fa_crm_optin_config_daily_cap_check check (daily_cap between 1 and 150);
alter table fa_crm_optin_config alter column daily_cap set default 150;
update fa_crm_optin_config set daily_cap = 150 where id = 1 and daily_cap = 20;

alter table fa_crm_optin_config
  add column if not exists started_at_ms bigint,
  add column if not exists deadline_days smallint not null default 15 check (deadline_days between 1 and 60),
  add column if not exists ramp_level smallint not null default 0,
  add column if not exists target_day_ms bigint,
  add column if not exists today_target integer not null default 0;

-- Iniciar/pausar: só o Owner. Iniciar limpa o motivo da última pausa e marca
-- o início do prazo na primeira vez (pausar e retomar não reinicia o prazo).
create or replace function fa_crm_optin_set_status(p_status text) returns void as $$
begin
  if not fa_kiosk_can('crm.admin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_status not in ('PAUSED', 'RUNNING') then
    raise exception 'status inválido';
  end if;
  update fa_crm_optin_config
     set status = p_status,
         paused_reason = case when p_status = 'RUNNING' then null else coalesce(paused_reason, 'pausada manualmente') end,
         started_at_ms = case when p_status = 'RUNNING' then coalesce(started_at_ms, (extract(epoch from now()) * 1000)::bigint) else started_at_ms end,
         updated_at_ms = (extract(epoch from now()) * 1000)::bigint
   where id = 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- "Hoje" = dia de Belém (UTC-3, sem horário de verão). dailyTarget é a meta
-- que a Edge Function calculou na 1ª rodada de hoje (null antes dela).
create or replace function fa_crm_optin_stats() returns jsonb as $$
declare
  v_start_ms bigint := (extract(epoch from date_trunc('day', now() at time zone 'America/Belem') at time zone 'America/Belem') * 1000)::bigint;
  cfg fa_crm_optin_config;
begin
  if not fa_kiosk_can('crm.admin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into cfg from fa_crm_optin_config where id = 1;
  return jsonb_build_object(
    'status', cfg.status,
    'dailyCap', cfg.daily_cap,
    'dailyTarget', case when cfg.target_day_ms = v_start_ms then cfg.today_target end,
    'deadlineDays', cfg.deadline_days,
    'deadlineDay', case when cfg.started_at_ms is not null then
      ((v_start_ms - (extract(epoch from date_trunc('day', to_timestamp(cfg.started_at_ms / 1000.0) at time zone 'America/Belem') at time zone 'America/Belem') * 1000)::bigint) / 86400000) + 1
    end,
    'pausedReason', cfg.paused_reason,
    'sentToday', (select count(*) from fa_crm_optin_requests where sent_at_ms >= v_start_ms),
    'sent', (select count(*) from fa_crm_optin_requests),
    'accepted', (select count(*) from fa_crm_optin_requests where status = 'ACCEPTED'),
    'declined', (select count(*) from fa_crm_optin_requests where status = 'DECLINED'),
    'pending', (select count(*) from fa_crm_optin_candidates(100000)),
    'withConsent', (select count(*) from fa_kiosk_guardians where whatsapp_consent_at_ms is not null)
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

do $$
begin
  perform cron.unschedule('fa-crm-optin-dispatch');
exception when others then null;
end $$;

-- A cada 5 min, 11h-22h UTC = 8h-19h55 em Belém. Timeout longo porque uma
-- rodada pode esperar até 90 s entre dois envios.
select cron.schedule(
  'fa-crm-optin-dispatch',
  '*/5 11-22 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-optin-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 150000
     ); $$
);
