-- WhatsApp: rastreio de entrega por mensagem, bloqueio de número inválido e custo por categoria.
--
-- 1) Status callback: o crm-whatsapp-webhook já recebia sent/delivered/read/failed, mas só guardava o
--    último status. Passa a guardar QUANDO entregou/leu/falhou e o CÓDIGO de erro (coluna própria,
--    além do texto "Twilio <código>" que o trigger do relatório de sessão já usa).
-- 2) Falha permanente (número sem WhatsApp / inválido): o contato é pausado (opt_in = false com
--    opt_out_reason = 'DELIVERY_FAILED') em todos os canais, e todos os dispatchers já pulam
--    quem tem opt_in = false. Quando o responsável escreve de volta, o webhook reativa.
--    63049 (a Meta decidiu não entregar aquela mensagem) NÃO é permanente: 14 dos 38 contatos
--    que tiveram 63049 também receberam outras mensagens.
-- 3) Custo: categoria do template (declarada; a function crm-whatsapp-cost-sync confere a que a Meta
--    efetivamente aplicou) e preço informado pela Twilio por mensagem.

-- ── templates ──
alter table fa_crm_templates
  add column if not exists category text check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  add column if not exists meta_status text,
  add column if not exists category_checked_at_ms bigint;

update fa_crm_templates t set category = v.category
from (values
  ('fa_nps_pos_visita', 'UTILITY'), ('fa_nps_pos_visita_v2', 'UTILITY'),
  ('fa_pedido_autorizacao', 'UTILITY'), ('fa_pedido_autorizacao_v2', 'UTILITY'),
  ('fa_renovacao_fim_plano', 'UTILITY'), ('fa_renovacao_fim_plano_v2', 'UTILITY'),
  ('fa_visita_boas_vindas', 'UTILITY'), ('fa_visita_excedente', 'UTILITY'), ('fa_visita_excedente_v2', 'UTILITY'),
  ('fa_visita_renovacao_ok', 'UTILITY'), ('fa_visita_fidelidade_v2', 'UTILITY'),
  ('fa_relatorio_sessao_v3', 'UTILITY'), ('fa_relatorio_sessao_pdf_v2', 'UTILITY'),
  ('fa_lc_expiracao', 'UTILITY'), ('fa_lc_relatorio_cupom', 'UTILITY'), ('fa_lc_premio_fidelidade', 'UTILITY'),
  ('fa_lc_nps_detrator', 'UTILITY'), ('fa_lc_nps_promotor', 'UTILITY'),
  ('fa_mapeamento_followup', 'MARKETING'), ('fa_lc_cross_irmao', 'MARKETING'), ('fa_lc_aniversario', 'MARKETING'),
  ('fa_oferta_degrau_2h', 'MARKETING'), ('fa_oferta_porto_seguro', 'MARKETING'), ('fa_oferta_day_use', 'MARKETING'),
  ('fa_oferta_cross_atividade_v2', 'MARKETING'), ('fa_oferta_vip_v2', 'MARKETING'), ('fa_oferta_winback_v2', 'MARKETING'),
  ('fa_optin_marketing', 'MARKETING'), ('fa_lc_upsell_pacote', 'MARKETING'), ('fa_lc_cross_atividade', 'MARKETING'),
  ('fa_lc_vip', 'MARKETING'), ('fa_lc_winback', 'MARKETING')
) as v(name, category)
where t.name = v.name and t.category is null;

-- ── mensagens ──
alter table fa_crm_messages
  add column if not exists delivered_at_ms bigint,
  add column if not exists read_at_ms bigint,
  add column if not exists failed_at_ms bigint,
  add column if not exists error_code text,
  add column if not exists category text check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION', 'SERVICE')),
  add column if not exists price numeric(12, 6),          -- valor absoluto informado pela Twilio
  add column if not exists price_unit text,               -- ex.: USD
  add column if not exists price_synced_at_ms bigint;

-- Histórico: o código de erro já estava no texto "Twilio <código>".
update fa_crm_messages set error_code = nullif(regexp_replace(error, '^Twilio\s+', ''), '')
 where error_code is null and error ~ '^Twilio\s+\d+$';

-- OUT sem categoria: a do template; sem template é conversa dentro da janela de 24h (SERVICE, gratuita na Meta).
create or replace function fa_crm_message_default_category() returns trigger as $$
begin
  if new.direction = 'OUT' and new.category is null then
    new.category := coalesce((select t.category from fa_crm_templates t where t.id = new.template_id), case when new.template_id is null then 'SERVICE' end);
  end if;
  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

drop trigger if exists trg_fa_crm_message_default_category on fa_crm_messages;
create trigger trg_fa_crm_message_default_category
  before insert on fa_crm_messages
  for each row execute function fa_crm_message_default_category();

update fa_crm_messages m set category = coalesce(
  (select t.category from fa_crm_templates t where t.id = m.template_id),
  case when m.template_id is null then 'SERVICE' end)
where m.direction = 'OUT' and m.category is null;

create index if not exists idx_fa_crm_messages_price_pending
  on fa_crm_messages (created_at_ms desc)
  where direction = 'OUT' and twilio_sid is not null and price_synced_at_ms is null and status in ('sent', 'delivered', 'read');

-- ── contatos ──
alter table fa_crm_contacts
  add column if not exists opt_out_reason text check (opt_out_reason in ('USER_STOP', 'DELIVERY_FAILED'));
-- Quem já mandou PARAR (opt_in = false) fica registrado como pedido do usuário.
update fa_crm_contacts set opt_out_reason = 'USER_STOP' where opt_in = false and opt_out_reason is null;

-- ── painel: entrega e custo por categoria ──
create or replace function fa_crm_whatsapp_cost_stats(p_days integer default 30)
returns table (
  category text, period text, sent bigint, delivered bigint, read_count bigint, failed bigint,
  priced bigint, price_total numeric, price_unit text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_day bigint := 86400000;
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
           max(m.price_unit)
    from fa_crm_messages m
    where m.direction = 'OUT' and m.twilio_sid is not null
      and m.created_at_ms > v_now - 2 * p_days * v_day
    group by 1, 2;
end;
$$;
revoke execute on function fa_crm_whatsapp_cost_stats(integer) from public, anon;
grant execute on function fa_crm_whatsapp_cost_stats(integer) to authenticated;

-- Conferência de preço/categoria a cada 30 min (a Twilio só informa o preço depois da entrega).
do $$
begin
  perform cron.unschedule('fa-crm-whatsapp-cost-sync');
exception when others then null;
end $$;
select cron.schedule(
  'fa-crm-whatsapp-cost-sync',
  '*/30 * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-cost-sync',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ); $$
);
