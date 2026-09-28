-- Avisos da visita por WhatsApp que a tela pública de acompanhamento já mostra
-- e o CRM ainda não enviava:
--   WELCOME     boas-vindas no check-in, com o link ?acompanhar=<code>
--   OVERAGE     "o tempo do plano terminou" + valor do minuto adicional
--   RENEWAL_OK  confirmação de que o balcão aplicou a renovação pedida
--   LOYALTY     progresso do cartão fidelidade (8ª/9ª/10ª visita) após o checkout
--
-- Mesmo desenho do aviso de renovação (20260928160000): pg_cron (1 min) ->
-- Edge Function crm-visit-notify-dispatch -> template aprovado (business-initiated)
-- -> fa_crm_messages. Só quem deu o aceite de contato no check-in
-- (fa_kiosk_guardians.whatsapp_consent_at_ms) recebe.
--
-- DESLIGADO POR PADRÃO, POR UNIDADE E POR TIPO: fa_kiosk_app_settings
-- 'crm_notify_welcome' | 'crm_notify_overage' | 'crm_notify_renewal_ok' |
-- 'crm_notify_loyalty' = '1'. Sem canal ou sem template ativo do tipo: não envia.

-- Recompõe o check com TODOS os propósitos vigentes. As migrations 20260928165000
-- (OPTIN) e 20260928170000 (RELATORIO_SESSAO) redefiniram o mesmo check cada uma
-- sem conhecer a outra; aqui ficam os dois juntos.
alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in (
    'GERAL', 'NPS', 'RENOVACAO', 'OPTIN', 'RELATORIO_SESSAO',
    'VISITA_BOAS_VINDAS', 'VISITA_EXCEDENTE', 'VISITA_RENOVACAO_OK', 'VISITA_FIDELIDADE'
  ));

-- Uma linha por aviso enviado. A unique (session_id, kind, ref_ms) é a trava de
-- idempotência do cron: ref_ms = 0 nos avisos únicos por sessão e o at_ms do
-- evento RENOVACAO_APLICADA em RENEWAL_OK (uma sessão pode renovar mais de uma vez).
create table if not exists fa_crm_visit_notifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references fa_kiosk_sessions (id),
  kind text not null check (kind in ('WELCOME', 'OVERAGE', 'RENEWAL_OK', 'LOYALTY')),
  ref_ms bigint not null default 0,
  contact_id uuid references fa_crm_contacts (id) on delete set null,
  channel_id uuid references fa_crm_channels (id),
  error text,
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (session_id, kind, ref_ms)
);

create index if not exists idx_fa_crm_visit_notifications_contact
  on fa_crm_visit_notifications (contact_id, sent_at_ms desc);

alter table fa_crm_visit_notifications enable row level security;
drop policy if exists fa_crm_visit_notifications_read on fa_crm_visit_notifications;
create policy fa_crm_visit_notifications_read on fa_crm_visit_notifications
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- Candidatos dos 4 avisos, já sem quem foi avisado e sem unidade com o tipo
-- desligado. Janelas curtas: se o cron ficar parado, o aviso vencido não sai
-- atrasado (ninguém quer "bem-vindo" 2h depois da entrada).
--   minutes  RENEWAL_OK: minutos da renovação · demais: null
--   cents    OVERAGE: centavos por minuto adicional · demais: null
--   visit_cycle  LOYALTY: posição da visita no ciclo de 10 (8, 9 ou 10)
create or replace function fa_crm_visit_candidates(p_now_ms bigint)
returns table (
  kind text, session_id uuid, ref_ms bigint, unit_id uuid, guardian_id uuid,
  guardian_name text, phone_e164 text, child_first_name text, activity text,
  access_code text, minutes integer, cents integer, visit_cycle integer
)
language sql security definer set search_path = public, pg_temp as $$
  with base as (
    select s.id as sid, s.unit_id, s.status, s.checkin_at_ms, s.checkout_at_ms,
           s.paused_ms_total, s.paused_at_ms, s.uses_hour_bank, s.uses_package,
           coalesce(s.activity, 'PLAYGROUND') as activity, s.access_code, s.child_id,
           s.guardian_id, s.plan_id, split_part(s.child_name_snapshot, ' ', 1) as child_first,
           g.full_name as gname, g.phone_e164 as gphone
    from fa_kiosk_sessions s
    join fa_kiosk_guardians g on g.id = s.guardian_id
    where g.whatsapp_consent_at_ms is not null
      and g.phone_e164 is not null
      and (s.status = 'ATIVA'
           or (s.status = 'FINALIZADA' and s.checkout_at_ms > p_now_ms - 2 * 3600 * 1000))
  ),
  cand as (
    -- WELCOME: entrou há pouco. Banco de horas/pacote ficam de fora: a tela
    -- pública responde NAO_SUPORTADO para eles, então o link não serviria.
    select 'WELCOME'::text as kind, b.sid, 0::bigint as ref_ms, b.unit_id, b.guardian_id,
           b.gname, b.gphone, b.child_first, b.activity, b.access_code,
           null::integer as minutes, null::integer as cents, null::integer as visit_cycle
    from base b
    where b.status = 'ATIVA'
      and not b.uses_hour_bank and not coalesce(b.uses_package, false)
      and b.access_code is not null
      and b.checkin_at_ms > p_now_ms - 20 * 60000

    union all

    -- OVERAGE: o teto do plano passou há até 45 min e a sessão segue rodando.
    -- Pausada espera (o relógio está parado). Pedido de renovação pendente
    -- também espera: o balcão vai estender, "excedente" seria ruído.
    select 'OVERAGE', b.sid, 0, b.unit_id, b.guardian_id,
           b.gname, b.gphone, b.child_first, b.activity, b.access_code,
           null, p.overage_cents_per_minute, null
    from base b
    join fa_kiosk_plans p on p.id = b.plan_id
    cross join lateral (select fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) as minutes) d
    where b.status = 'ATIVA'
      and b.paused_at_ms is null
      and not b.uses_hour_bank and not coalesce(b.uses_package, false)
      and p.overage_cents_per_minute > 0
      and b.checkin_at_ms + coalesce(b.paused_ms_total, 0) + d.minutes::bigint * 60000 <= p_now_ms
      and b.checkin_at_ms + coalesce(b.paused_ms_total, 0) + d.minutes::bigint * 60000 > p_now_ms - 45 * 60000
      and coalesce((
        select e.kind from fa_kiosk_session_events e
        where e.session_id = b.sid
          and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
        order by e.at_ms desc limit 1
      ), '') <> 'RENOVACAO_SOLICITADA'

    union all

    -- RENEWAL_OK: o balcão marcou o pedido como aplicado nos últimos 30 min.
    -- Os minutos vêm do último RENOVACAO_SOLICITADA antes da aplicação.
    select 'RENEWAL_OK', b.sid, ea.at_ms, b.unit_id, b.guardian_id,
           b.gname, b.gphone, b.child_first, b.activity, b.access_code,
           rq.minutes, null, null
    from base b
    join fa_kiosk_session_events ea on ea.session_id = b.sid and ea.kind = 'RENOVACAO_APLICADA'
    cross join lateral (
      select nullif(es.payload_json ->> 'minutes', '')::integer as minutes
      from fa_kiosk_session_events es
      where es.session_id = b.sid and es.kind = 'RENOVACAO_SOLICITADA' and es.at_ms < ea.at_ms
      order by es.at_ms desc limit 1
    ) rq
    where b.status = 'ATIVA'
      and ea.at_ms > p_now_ms - 30 * 60000
      and rq.minutes > 0

    union all

    -- LOYALTY: checkout na última hora (cancelada não tem checkout_at_ms). A
    -- contagem espelha fa_acompanhar_por_codigo (visitas da criança, ou do
    -- responsável sem child_id), até esta sessão, para o número bater com o que
    -- a tela pública mostrou.
    select 'LOYALTY', b.sid, 0, b.unit_id, b.guardian_id,
           b.gname, b.gphone, b.child_first, b.activity, b.access_code,
           null, null, v.cycle
    from base b
    cross join lateral (
      select (((count(*) - 1) % 10) + 1)::integer as cycle
      from fa_kiosk_sessions x
      where case when b.child_id is not null then x.child_id = b.child_id
                 else x.guardian_id = b.guardian_id end
        and x.checkin_at_ms <= b.checkin_at_ms
    ) v
    where b.status = 'FINALIZADA'
      and b.checkout_at_ms is not null
      and b.checkout_at_ms > p_now_ms - 60 * 60000
      and v.cycle in (8, 9, 10)
  )
  select c.kind, c.sid, c.ref_ms, c.unit_id, c.guardian_id, c.gname, c.gphone, c.child_first,
         c.activity, c.access_code, c.minutes, c.cents, c.visit_cycle
  from cand c
  where not exists (
          select 1 from fa_crm_visit_notifications n
          where n.session_id = c.sid and n.kind = c.kind and n.ref_ms = c.ref_ms
        )
    and exists (
          select 1 from fa_kiosk_app_settings st
          where st.unit_id = c.unit_id and st.key = 'crm_notify_' || lower(c.kind) and st.value = '1'
        )
$$;

revoke execute on function fa_crm_visit_candidates(bigint) from public, anon, authenticated;
grant execute on function fa_crm_visit_candidates(bigint) to service_role;

do $$
begin
  perform cron.unschedule('fa-crm-visit-notify');
exception when others then null;
end $$;

select cron.schedule(
  'fa-crm-visit-notify',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-visit-notify-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
