-- NPS automático só a partir da 2ª visita. Antes, todo responsável com aceite
-- recebia o NPS após qualquer visita finalizada (cooldown de 30 dias por contato
-- no dispatcher). Agora a RPC só devolve quem tem 2+ sessões FINALIZADAS (a
-- visita atual conta: 2ª visita = 2 sessões). Soma todas as atividades.
--
-- Só leitura: nenhum responsável, criança ou contato é alterado ou apagado.
-- Assinatura inalterada; crm-nps-auto-dispatch não muda.
create or replace function fa_crm_nps_candidates(p_from_ms bigint, p_to_ms bigint)
returns table (guardian_id uuid, full_name text, phone_e164 text, activity text)
language sql security definer set search_path = public, pg_temp as $$
  select distinct on (g.id, s.activity) g.id, g.full_name, g.phone_e164, s.activity
  from fa_kiosk_sessions s
  join fa_kiosk_guardians g on g.id = s.guardian_id
  where s.status = 'FINALIZADA'
    and s.checkout_at_ms between p_from_ms and p_to_ms
    and g.whatsapp_consent_at_ms is not null
    and exists (
      select 1 from fa_kiosk_app_settings a
      where a.unit_id = s.unit_id and a.key = 'crm_nps_auto' and a.value = '1'
    )
    and (
      select count(*) from fa_kiosk_sessions x
      where x.guardian_id = g.id and x.status = 'FINALIZADA'
    ) >= 2
  order by g.id, s.activity, s.checkout_at_ms desc
$$;

revoke execute on function fa_crm_nps_candidates(bigint, bigint) from public, anon, authenticated;
