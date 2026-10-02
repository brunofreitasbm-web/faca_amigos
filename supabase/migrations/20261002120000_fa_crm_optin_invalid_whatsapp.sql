-- Número sem WhatsApp (erro Twilio 63024 no status da mensagem): o responsável
-- sai das filas de opt-in. Marcado por crm-whatsapp-webhook; aqui só a coluna,
-- o backfill do que já falhou e as filas passando a ignorar a marca.
-- Complementa o ajuste do freio automático: erro do destinatário (63024, 63049,
-- 63050, 63033, 63003) não conta como falha, ver crm-optin-dispatch/pacing.ts.

alter table fa_kiosk_guardians add column if not exists whatsapp_invalid_at_ms bigint;

update fa_kiosk_guardians g
   set whatsapp_invalid_at_ms = (extract(epoch from now()) * 1000)::bigint
 where g.whatsapp_invalid_at_ms is null
   and exists (
     select 1
       from fa_crm_contacts c
       join fa_crm_messages m on m.contact_id = c.id
      where c.guardian_id = g.id
        and m.error = 'Twilio 63024'
   );

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
    and g.whatsapp_invalid_at_ms is null
    and g.phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$'
    and s.checkin_at_ms > (extract(epoch from now()) * 1000)::bigint - 90::bigint * 86400000
    and not exists (select 1 from fa_crm_optin_requests r where r.guardian_id = g.id)
    and not exists (select 1 from fa_crm_contacts c where c.phone_e164 = g.phone_e164 and not c.opt_in)
  order by s.checkin_at_ms desc
  limit p_limit
$$;

create or replace function fa_crm_marketing_optin_candidates(p_limit integer)
returns table (guardian_id uuid, full_name text, phone_e164 text, activity text)
language sql security definer set search_path = public, pg_temp as $$
  select g.id, g.full_name, g.phone_e164, s.activity
  from fa_kiosk_guardians g
  join lateral (
    select activity, checkin_at_ms from fa_kiosk_sessions
    where guardian_id = g.id and checkin_at_ms is not null
    order by checkin_at_ms desc limit 1
  ) s on true
  where g.whatsapp_consent_at_ms is not null
    and g.marketing_consent_at_ms is null
    and g.whatsapp_invalid_at_ms is null
    and g.phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$'
    and not exists (select 1 from fa_crm_marketing_optin_requests r where r.guardian_id = g.id)
    and not exists (select 1 from fa_crm_contacts c where c.phone_e164 = g.phone_e164 and not c.opt_in)
  order by s.checkin_at_ms desc
  limit p_limit
$$;

revoke execute on function fa_crm_optin_candidates(integer) from public, anon, authenticated;
revoke execute on function fa_crm_marketing_optin_candidates(integer) from public, anon, authenticated;
