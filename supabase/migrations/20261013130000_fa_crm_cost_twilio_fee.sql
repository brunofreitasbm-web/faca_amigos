-- O preço que a Twilio devolve por mensagem (fa_crm_messages.price) é só o da
-- Meta; a Twilio cobra à parte a taxa da plataforma. Sem ela, o painel de custo
-- ficava ~20% abaixo da fatura. Valores conferidos na fatura de out/2026:
--   enviada (não falha)  USD 0,005   (1880 msgs = USD 9,40)
--   enviada com falha    USD 0,001   (71 msgs    = USD 0,07)
--   recebida             USD 0,005   (414 msgs   = USD 2,07)
-- Se a Twilio reajustar, mudar as constantes abaixo.
-- Funções novas (_v2) porque o retorno ganhou a coluna twilio_fee; as antigas
-- (sem _v2) ficam sem uso e podem ser removidas depois.

create or replace function fa_crm_whatsapp_cost_stats_v2(p_days integer default 30)
returns table (
  category text, period text, sent bigint, delivered bigint, read_count bigint, failed bigint,
  priced bigint, price_total numeric, price_unit text, twilio_fee numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_day bigint := 86400000;
  c_fee_ok constant numeric := 0.005;
  c_fee_failed constant numeric := 0.001;
begin
  if not fa_kiosk_can('crm.admin') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  -- period 'current' = últimos p_days; 'previous' = os p_days anteriores (comparativo obrigatório no painel).
  return query
    select coalesce(m.category, 'DESCONHECIDA'),
           case when m.created_at_ms > v_now - p_days * v_day then 'current' else 'previous' end,
           count(*),
           count(*) filter (where m.status in ('delivered', 'read')),
           count(*) filter (where m.status = 'read'),
           count(*) filter (where m.status in ('failed', 'undelivered')),
           count(*) filter (where m.price is not null),
           coalesce(sum(m.price), 0),
           max(m.price_unit),
           count(*) filter (where m.status not in ('failed', 'undelivered')) * c_fee_ok
             + count(*) filter (where m.status in ('failed', 'undelivered')) * c_fee_failed
    from fa_crm_messages m
    where m.direction = 'OUT' and m.twilio_sid is not null
      and m.created_at_ms > v_now - 2 * p_days * v_day
    group by 1, 2
    union all
    -- Mensagens recebidas: sem preço da Meta, só a taxa da Twilio.
    select 'RECEBIDAS',
           case when m.created_at_ms > v_now - p_days * v_day then 'current' else 'previous' end,
           count(*), count(*), 0::bigint, 0::bigint, 0::bigint, 0::numeric, null::text,
           count(*) * c_fee_ok
    from fa_crm_messages m
    where m.direction = 'IN'
      and m.created_at_ms > v_now - 2 * p_days * v_day
    group by 2;
end;
$$;
revoke execute on function fa_crm_whatsapp_cost_stats_v2(integer) from public, anon;
grant execute on function fa_crm_whatsapp_cost_stats_v2(integer) to authenticated;

-- Por finalidade (card "Mensagens automáticas"): acrescenta a taxa da Twilio.
create or replace function fa_crm_message_stats_by_purpose_v2(p_days integer default 30)
returns table (
  purpose text, category text, sent bigint, delivered bigint, read_count bigint, failed bigint,
  replied bigint, price_total numeric, price_unit text, twilio_fee numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  c_fee_ok constant numeric := 0.005;
  c_fee_failed constant numeric := 0.001;
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
           max(m.price_unit),
           count(*) filter (where m.status not in ('failed', 'undelivered')) * c_fee_ok
             + count(*) filter (where m.status in ('failed', 'undelivered')) * c_fee_failed
    from fa_crm_messages m
    left join fa_crm_templates t on t.id = m.template_id
    where m.direction = 'OUT' and m.twilio_sid is not null
      and m.created_at_ms > v_now - p_days::bigint * 86400000
    group by 1, 2;
end;
$$;
revoke execute on function fa_crm_message_stats_by_purpose_v2(integer) from public, anon;
grant execute on function fa_crm_message_stats_by_purpose_v2(integer) to authenticated;
