-- Teto de marketing de 30 para 45 dias: no máximo 1 mensagem promocional a cada
-- 45 dias por pessoa. Mesma lista de purposes e mesmas exceções da migration
-- 20261013140000 (aniversário nunca bloqueado; operacionais fora do teto).
-- Só muda o intervalo. Nenhum lead é alterado.
create or replace function fa_crm_can_send(p_contact_id uuid, p_category text, p_now_ms bigint, p_kind text default null)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_category <> 'MARKETING' then true
    when coalesce(p_kind = 'ANIVERSARIO', false) then true
    else not exists (
      select 1
      from fa_crm_messages m
      join fa_crm_templates t on t.id = m.template_id
      join fa_crm_contacts c on c.id = m.contact_id
      where m.direction = 'OUT'
        and m.created_at_ms > p_now_ms - 45 * 86400000::bigint
        and m.status not in ('failed', 'undelivered')
        and t.purpose = any (array[
          'VISITA_BOAS_VINDAS', 'VISITA_FIDELIDADE', 'MAPEAMENTO', 'OPTIN_MARKETING', 'RELATORIO_CUPOM',
          'PREMIO_FIDELIDADE', 'UPSELL_PACOTE', 'DEGRAU_2H', 'DEGRAU_PORTO', 'DEGRAU_DAYUSE',
          'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'VIP', 'WINBACK', 'ANIVERSARIO'
        ])
        and right(c.phone_e164, 8) = (select right(x.phone_e164, 8) from fa_crm_contacts x where x.id = p_contact_id)
    )
  end
$$;
revoke execute on function fa_crm_can_send(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function fa_crm_can_send(uuid, text, bigint, text) to service_role;
