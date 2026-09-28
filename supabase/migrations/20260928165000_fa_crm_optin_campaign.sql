-- Campanha de opt-in para a base atual: UMA mensagem por responsável
-- perguntando se aceita contato por WhatsApp (avisos da visita e pesquisa).
--
-- NASCE PAUSADA. Só o Owner (crm.admin) inicia, pela aba CRM WhatsApp.
-- Teto de 20 envios/dia (check abaixo, não dá para subir sem nova migration),
-- só das 10h às 20h de Belém, dos mais recentes para os mais antigos, só quem
-- visitou nos últimos 90 dias e forneceu um celular brasileiro válido.
-- Freio automático (Edge Function crm-optin-dispatch): pausa se >3% pedirem
-- PARAR ou >20% das entregas falharem nas últimas 24h.
--
-- "SIM"/"QUERO" responde ao pedido -> crm-whatsapp-webhook grava
-- fa_kiosk_guardians.whatsapp_consent_at_ms. "PARAR" bloqueia e revoga.

alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in ('GERAL', 'NPS', 'OPTIN'));

create table if not exists fa_crm_optin_config (
  id smallint primary key default 1 check (id = 1),
  status text not null default 'PAUSED' check (status in ('PAUSED', 'RUNNING')),
  daily_cap smallint not null default 20 check (daily_cap between 1 and 20),
  paused_reason text,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
insert into fa_crm_optin_config (id) values (1) on conflict do nothing;

create table if not exists fa_crm_optin_requests (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null unique references fa_kiosk_guardians (id),
  contact_id uuid not null references fa_crm_contacts (id) on delete cascade,
  channel_id uuid not null references fa_crm_channels (id),
  status text not null default 'SENT' check (status in ('SENT', 'ACCEPTED', 'DECLINED')),
  twilio_sid text,
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  answered_at_ms bigint
);
create index if not exists idx_fa_crm_optin_sent on fa_crm_optin_requests (sent_at_ms desc);
create index if not exists idx_fa_crm_optin_contact on fa_crm_optin_requests (contact_id) where status = 'SENT';

alter table fa_crm_optin_config enable row level security;
alter table fa_crm_optin_requests enable row level security;

drop policy if exists fa_crm_optin_config_read on fa_crm_optin_config;
create policy fa_crm_optin_config_read on fa_crm_optin_config
  for select to authenticated using (fa_kiosk_can('crm.admin'));
drop policy if exists fa_crm_optin_requests_read on fa_crm_optin_requests;
create policy fa_crm_optin_requests_read on fa_crm_optin_requests
  for select to authenticated using (fa_kiosk_can('crm.admin'));

-- Iniciar/pausar: só o Owner. Iniciar limpa o motivo da última pausa.
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
         updated_at_ms = (extract(epoch from now()) * 1000)::bigint
   where id = 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_optin_set_status(text) from public, anon;
grant execute on function fa_crm_optin_set_status(text) to authenticated;

-- "Hoje" = dia de Belém (UTC-3, sem horário de verão).
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

revoke execute on function fa_crm_optin_stats() from public, anon;
grant execute on function fa_crm_optin_stats() to authenticated;

-- Fila: mais recentes primeiro, celular BR válido, sem aceite, sem pedido
-- anterior e sem PARAR registrado.
create or replace function fa_crm_optin_candidates(p_limit integer)
returns table (guardian_id uuid, full_name text, phone_e164 text, activity text)
language sql security definer set search_path = public, pg_temp as $$
  select g.id, g.full_name, g.phone_e164, s.activity
  from fa_kiosk_guardians g
  join lateral (
    select activity, checkin_at_ms from fa_kiosk_sessions
    where guardian_id = g.id and checkin_at_ms is not null
    order by checkin_at_ms desc limit 1
  ) s on true
  where g.whatsapp_consent_at_ms is null
    and g.phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$'
    and s.checkin_at_ms > (extract(epoch from now()) * 1000)::bigint - 90::bigint * 86400000
    and not exists (select 1 from fa_crm_optin_requests r where r.guardian_id = g.id)
    and not exists (select 1 from fa_crm_contacts c where c.phone_e164 = g.phone_e164 and not c.opt_in)
  order by s.checkin_at_ms desc
  limit p_limit
$$;

-- Só a Edge Function (service role) e fa_crm_optin_stats (definer) usam.
revoke execute on function fa_crm_optin_candidates(integer) from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('fa-crm-optin-dispatch');
exception when others then null;
end $$;

-- Minuto 5 de cada hora, 13h-22h UTC = 10h-19h em Belém. A function ainda
-- confere a janela e o teto do dia; com o teto de 20, saem até 2 por rodada.
select cron.schedule(
  'fa-crm-optin-dispatch',
  '5 13-22 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-optin-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
