-- Autorização do responsável para contato por WhatsApp (avisos da visita e
-- pesquisa de satisfação/NPS), coletada no check-in (EntradaScreen).
--
-- Fica FORA da RPC fa_checkin de propósito: o check-in é o caminho crítico do
-- balcão (e tem overloads/variantes de pelúcia) — o aceite é gravado logo
-- depois por esta RPC própria, e uma falha aqui nunca derruba uma entrada.
-- O caminho seguro em caso de falha é NÃO enviar: sem registro, sem NPS.
--
-- Guarda quando e por quem foi dado (prova do aceite, LGPD art. 8º §2º).
-- Revogar = p_consent false (zera a data).

alter table fa_kiosk_guardians add column if not exists whatsapp_consent_at_ms bigint;
alter table fa_kiosk_guardians add column if not exists whatsapp_consent_by_employee_id uuid references fa_kiosk_employees (id);

create or replace function fa_kiosk_set_whatsapp_consent(p_guardian_id uuid, p_consent boolean, p_employee_id uuid default null)
returns void as $$
begin
  if not fa_kiosk_can('sessao.checkin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update fa_kiosk_guardians
     set whatsapp_consent_at_ms = case when p_consent then (extract(epoch from now()) * 1000)::bigint else null end,
         whatsapp_consent_by_employee_id = case when p_consent then p_employee_id else null end
   where id = p_guardian_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_set_whatsapp_consent(uuid, boolean, uuid) from public, anon;
grant execute on function fa_kiosk_set_whatsapp_consent(uuid, boolean, uuid) to authenticated;

-- O NPS automático passa a exigir o aceite, além da chave por unidade.
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
  order by g.id, s.activity, s.checkout_at_ms desc
$$;

revoke execute on function fa_crm_nps_candidates(bigint, bigint) from public, anon, authenticated;
