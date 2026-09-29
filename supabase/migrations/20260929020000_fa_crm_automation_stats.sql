-- Estatísticas do catálogo de ciclo de vida (fa_crm_automation_sends), por
-- kind: enviados, responderam, converteram (pedido pago em até 14 dias — ver
-- trigger fa_crm_automation_attribute_order) e receita atribuída.
create or replace function fa_crm_automation_stats(p_days integer default 30)
returns table (kind text, sent bigint, replied bigint, converted bigint, converted_cents bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not fa_kiosk_can('crm.admin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select s.kind,
           count(*) filter (where s.status = 'SENT'),
           count(*) filter (where s.status = 'SENT' and s.replied_at_ms is not null),
           count(*) filter (where s.status = 'SENT' and s.converted_order_id is not null),
           coalesce(sum(o.total_cents) filter (where s.converted_order_id is not null), 0)
    from fa_crm_automation_sends s
    left join fa_kiosk_orders o on o.id = s.converted_order_id
    where s.created_at_ms > (extract(epoch from now()) * 1000)::bigint - p_days::bigint * 86400000::bigint
    group by s.kind;
end;
$$;

revoke execute on function fa_crm_automation_stats(integer) from public, anon;
grant execute on function fa_crm_automation_stats(integer) to authenticated;
