-- Convite ao Mapeamento Comportamental do Instituto por WhatsApp, 1 semana
-- depois da visita, UMA ÚNICA VEZ por responsável. O mesmo convite que a tela
-- pública de acompanhamento mostra (MapeamentoBanner), agora no WhatsApp,
-- tocando na "dor" da família e na promessa do FaçaAmigos.
--
-- Mesmo desenho dos avisos da visita (20260928180000): pg_cron (1x/hora) ->
-- Edge Function crm-mapeamento-dispatch -> template aprovado (Marketing) ->
-- fa_crm_messages. Só quem deu o aceite de contato no check-in
-- (fa_kiosk_guardians.whatsapp_consent_at_ms) recebe.
--
-- DESLIGADO POR PADRÃO, POR UNIDADE: fa_kiosk_app_settings
-- 'crm_mapeamento_followup' = '1'. Sem canal ou sem template ativo: não envia.

alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in (
    'GERAL', 'NPS', 'RENOVACAO', 'OPTIN', 'RELATORIO_SESSAO',
    'VISITA_BOAS_VINDAS', 'VISITA_EXCEDENTE', 'VISITA_RENOVACAO_OK', 'VISITA_FIDELIDADE',
    'MAPEAMENTO'
  ));

-- Uma linha por responsável: guardian_id unique é a trava do "uma única vez"
-- (e a de idempotência do cron — gravada ANTES do envio).
create table if not exists fa_crm_mapeamento_invites (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null unique references fa_kiosk_guardians (id),
  session_id uuid not null references fa_kiosk_sessions (id),
  contact_id uuid references fa_crm_contacts (id) on delete set null,
  channel_id uuid references fa_crm_channels (id),
  error text,
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_fa_crm_mapeamento_invites_contact
  on fa_crm_mapeamento_invites (contact_id, sent_at_ms desc);

alter table fa_crm_mapeamento_invites enable row level security;
drop policy if exists fa_crm_mapeamento_invites_read on fa_crm_mapeamento_invites;
create policy fa_crm_mapeamento_invites_read on fa_crm_mapeamento_invites
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- Candidatos: responsáveis com aceite, sem convite anterior, cuja sessão
-- terminou entre 7 e 9 dias atrás (checkout real; cancelada não tem
-- checkout_at_ms). A janela de 2 dias tolera o cron parado por até 2 dias sem
-- mandar convite "de uma semana" para visita de um mês atrás — e impede que a
-- base antiga toda receba de uma vez quando a flag for ligada.
-- Um responsável por linha: a visita mais antiga dentro da janela.
--   child_age_years  idade da criança daquela sessão (para a "dor" por faixa)
create or replace function fa_crm_mapeamento_candidates(p_now_ms bigint)
returns table (
  session_id uuid, unit_id uuid, guardian_id uuid, guardian_name text, phone_e164 text,
  child_first_name text, child_age_years integer, activity text
)
language sql security definer set search_path = public, pg_temp as $$
  select distinct on (g.id)
         s.id, s.unit_id, g.id, g.full_name, g.phone_e164,
         split_part(s.child_name_snapshot, ' ', 1),
         extract(year from age(current_date, c.birth_date))::integer,
         coalesce(s.activity, 'PLAYGROUND')
  from fa_kiosk_sessions s
  join fa_kiosk_guardians g on g.id = s.guardian_id
  left join fa_kiosk_children c on c.id = s.child_id
  where s.status = 'FINALIZADA'
    and s.checkout_at_ms between p_now_ms - 9 * 86400000::bigint and p_now_ms - 7 * 86400000::bigint
    and g.whatsapp_consent_at_ms is not null
    and g.phone_e164 is not null
    and not exists (select 1 from fa_crm_mapeamento_invites i where i.guardian_id = g.id)
    and exists (
      select 1 from fa_kiosk_app_settings st
      where st.unit_id = s.unit_id and st.key = 'crm_mapeamento_followup' and st.value = '1'
    )
  order by g.id, s.checkout_at_ms asc
$$;

revoke execute on function fa_crm_mapeamento_candidates(bigint) from public, anon, authenticated;
grant execute on function fa_crm_mapeamento_candidates(bigint) to service_role;

do $$
begin
  perform cron.unschedule('fa-crm-mapeamento-followup');
exception when others then null;
end $$;

-- De hora em hora, das 9h às 20h (Belém = UTC-3 → 12h-23h UTC): convite de
-- marketing não chega de madrugada.
select cron.schedule(
  'fa-crm-mapeamento-followup',
  '0 12-23 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-mapeamento-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
