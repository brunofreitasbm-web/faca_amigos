-- Painel "Mensagens automáticas" (Gerencial > CRM): entrega, resposta e custo
-- por finalidade de template (fa_crm_templates.purpose), para decidir o que
-- desligar. "Respondeu" = o contato mandou qualquer mensagem em até 48h depois
-- do envio (inclui toque em botão de template). Envios sem template (texto
-- livre dentro da janela de 24h) entram como purpose nulo.
create or replace function fa_crm_message_stats_by_purpose(p_days integer default 30)
returns table (
  purpose text, category text, sent bigint, delivered bigint, read_count bigint, failed bigint,
  replied bigint, price_total numeric, price_unit text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not fa_kiosk_can('crm.admin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select t.purpose,
           coalesce(m.category, t.category, 'DESCONHECIDA'),
           count(*),
           count(*) filter (where m.status in ('delivered', 'read')),
           count(*) filter (where m.status = 'read'),
           count(*) filter (where m.status in ('failed', 'undelivered')),
           count(*) filter (where exists (
             select 1 from fa_crm_messages i
             where i.contact_id = m.contact_id and i.direction = 'IN'
               and i.created_at_ms between m.created_at_ms and m.created_at_ms + 172800000)),
           coalesce(sum(m.price), 0),
           max(m.price_unit)
    from fa_crm_messages m
    left join fa_crm_templates t on t.id = m.template_id
    where m.direction = 'OUT' and m.twilio_sid is not null
      and m.created_at_ms > v_now - p_days::bigint * 86400000
    group by 1, 2;
end;
$$;
revoke execute on function fa_crm_message_stats_by_purpose(integer) from public, anon;
grant execute on function fa_crm_message_stats_by_purpose(integer) to authenticated;
