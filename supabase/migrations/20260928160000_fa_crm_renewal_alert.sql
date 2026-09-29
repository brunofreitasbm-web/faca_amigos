-- Aviso de fim de plano + oferta de renovação por WhatsApp. Substitui o
-- "avisar 5 min antes" (Web Push) e o bloco de renovação da tela pública de
-- acompanhamento (AcompanharScreen): o CRM avisa o responsável e ele escolhe
-- +Y min por R$ Z tocando num botão de resposta rápida do template.
--
-- Fluxo: pg_cron (1 min) -> Edge Function crm-renewal-alert-dispatch ->
-- template aprovado com 3 botões (business-initiated, exige template) ->
-- toque do cliente cai no crm-whatsapp-webhook -> fa_crm_renewal_choose grava
-- RENOVACAO_SOLICITADA em fa_kiosk_session_events, o MESMO evento que o balcão
-- já consome (renewalRequests.ts) — sem cobrança automática, o operador aplica
-- no caixa como antes.
--
-- DESLIGADO POR PADRÃO, POR UNIDADE: só envia para unidades com
-- fa_kiosk_app_settings ('crm_renewal_alert' = '1') e só a quem deu o aceite de
-- contato por WhatsApp no check-in (fa_kiosk_guardians.whatsapp_consent_at_ms).
-- Sem aceite ou sem canal/template ativo: não envia (caminho seguro).

alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in ('GERAL', 'NPS', 'OPTIN', 'RENOVACAO'));

-- Um aviso por sessão (unique) — é também a trava de idempotência do cron.
create table if not exists fa_crm_renewal_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references fa_kiosk_sessions (id),
  contact_id uuid references fa_crm_contacts (id) on delete set null,
  channel_id uuid references fa_crm_channels (id),
  -- [{minutes, cents}] na ordem dos botões 1..3, congelado no envio: o preço
  -- que o cliente viu é o que vale, mesmo se a tabela mudar depois.
  options jsonb not null,
  error text,
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  chosen_index smallint check (chosen_index between 1 and 3),
  chosen_at_ms bigint
);

create index if not exists idx_fa_crm_renewal_alerts_contact on fa_crm_renewal_alerts (contact_id, sent_at_ms desc);

alter table fa_crm_renewal_alerts enable row level security;
drop policy if exists fa_crm_renewal_alerts_read on fa_crm_renewal_alerts;
create policy fa_crm_renewal_alerts_read on fa_crm_renewal_alerts
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- Sessões que já passaram do minuto de alerta e ainda não acabaram.
-- Playground: teto - 5 min. Circuito: régua de fa_circuito_alert_at_minutes
-- (sem régua para a combinação = sem aviso). Banco de horas fica de fora, como
-- no Web Push. Sessão PAUSADA espera: o cron pega quando voltar a ATIVA.
create or replace function fa_crm_renewal_candidates(p_now_ms bigint)
returns table (
  session_id uuid, guardian_id uuid, guardian_name text, phone_e164 text,
  child_first_name text, activity text, asset_kind text, duration_minutes integer
)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, g.id, g.full_name, g.phone_e164,
         split_part(s.child_name_snapshot, ' ', 1), s.activity, p.asset_kind, d.minutes
  from fa_kiosk_sessions s
  join fa_kiosk_guardians g on g.id = s.guardian_id
  join fa_kiosk_plans p on p.id = s.plan_id
  cross join lateral (select fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) as minutes) d
  cross join lateral (
    select case when s.activity = 'CARRINHO'
                then fa_circuito_alert_at_minutes(p.asset_kind, d.minutes)
                else greatest(0, d.minutes - 5) end as minutes
  ) a
  where s.status = 'ATIVA'
    and not s.uses_hour_bank
    and a.minutes is not null
    and g.whatsapp_consent_at_ms is not null
    and g.phone_e164 is not null
    and s.checkin_at_ms + coalesce(s.paused_ms_total, 0) + a.minutes::bigint * 60000 <= p_now_ms
    and s.checkin_at_ms + coalesce(s.paused_ms_total, 0) + d.minutes::bigint * 60000 > p_now_ms
    and not exists (select 1 from fa_crm_renewal_alerts r where r.session_id = s.id)
    and exists (
      select 1 from fa_kiosk_app_settings st
      where st.unit_id = s.unit_id and st.key = 'crm_renewal_alert' and st.value = '1'
    )
$$;

revoke execute on function fa_crm_renewal_candidates(bigint) from public, anon, authenticated;

-- Toque no botão (ou "1"/"2"/"3"): grava o pedido de renovação no balcão.
-- Atômico e idempotente — o WhatsApp reentrega e o cliente toca duas vezes.
-- Devolve OK | ALREADY | EXPIRED | NONE para o webhook escolher a resposta.
create or replace function fa_crm_renewal_choose(p_contact_id uuid, p_choice integer, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alert record;
  v_opt jsonb;
  v_status text;
begin
  select * into v_alert from fa_crm_renewal_alerts
   where contact_id = p_contact_id and sent_at_ms > p_now_ms - 2 * 3600 * 1000
   order by sent_at_ms desc limit 1
   for update;
  if not found then return jsonb_build_object('status', 'NONE'); end if;

  v_opt := v_alert.options -> (p_choice - 1);
  if v_opt is null then return jsonb_build_object('status', 'NONE'); end if;
  if v_alert.chosen_at_ms is not null then return jsonb_build_object('status', 'ALREADY'); end if;

  select status into v_status from fa_kiosk_sessions where id = v_alert.session_id;
  if v_status is distinct from 'ATIVA' and v_status is distinct from 'PAUSADA' then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  update fa_crm_renewal_alerts set chosen_index = p_choice, chosen_at_ms = p_now_ms where id = v_alert.id;
  perform fa_kiosk_log_session_event(
    v_alert.session_id, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int, 'via', 'WHATSAPP', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int);
end;
$$;

revoke execute on function fa_crm_renewal_choose(uuid, integer, bigint) from public, anon, authenticated;
grant execute on function fa_crm_renewal_choose(uuid, integer, bigint) to service_role;
grant execute on function fa_crm_renewal_candidates(bigint) to service_role;

do $$
begin
  perform cron.unschedule('fa-crm-renewal-alert');
exception when others then null;
end $$;

select cron.schedule(
  'fa-crm-renewal-alert',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-renewal-alert-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
