-- NPS automático pós-visita. A cada 15 min o pg_cron chama a Edge Function
-- crm-nps-auto-dispatch, que pesquisa os responsáveis cuja sessão terminou
-- entre 2h e 6h atrás (fa_crm_nps_candidates).
--
-- DESLIGADO POR PADRÃO, POR UNIDADE: só envia para unidades com
-- fa_kiosk_app_settings ('crm_nps_auto' = '1'), que só o Owner liga, depois
-- de a autorização de contato por WhatsApp/pesquisa constar nos Termos de Uso
-- ou no cadastro do check-in (hoje não consta). Mesmo ligado, nada é enviado
-- sem canal ativo (fa_crm_channels) e sem template NPS aprovado e ativo
-- (fa_crm_templates).
--
-- Sessão cancelada também vira FINALIZADA, mas sem checkout_at_ms — o filtro
-- por checkout_at_ms exclui esses casos (ninguém recebe NPS de visita cancelada).

create or replace function fa_crm_nps_candidates(p_from_ms bigint, p_to_ms bigint)
returns table (guardian_id uuid, full_name text, phone_e164 text, activity text)
language sql security definer set search_path = public, pg_temp as $$
  select distinct on (g.id, s.activity) g.id, g.full_name, g.phone_e164, s.activity
  from fa_kiosk_sessions s
  join fa_kiosk_guardians g on g.id = s.guardian_id
  where s.status = 'FINALIZADA'
    and s.checkout_at_ms between p_from_ms and p_to_ms
    and exists (
      select 1 from fa_kiosk_app_settings a
      where a.unit_id = s.unit_id and a.key = 'crm_nps_auto' and a.value = '1'
    )
  order by g.id, s.activity, s.checkout_at_ms desc
$$;

-- Só a Edge Function (service role) chama.
revoke execute on function fa_crm_nps_candidates(bigint, bigint) from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('fa-crm-nps-auto');
exception when others then null;
end $$;

select cron.schedule(
  'fa-crm-nps-auto',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-nps-auto-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
