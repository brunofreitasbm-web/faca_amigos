-- Catálogo de automações de upsell/cross-sell/LTV/retenção via WhatsApp.
--
-- UM dispatcher (crm-lifecycle-dispatch, cron a cada 15 min) para todos os
-- "kinds" abaixo, em vez de uma Edge Function por ação. fa_crm_automation_sends
-- é a tabela genérica de envio + resposta + conversão (substitui criar uma
-- tabela por feature). fa_crm_lc_candidates(p_now_ms) é a única função que o
-- dispatcher chama — um UNION ALL por kind, cada um com sua trava própria.
--
-- SEGURANÇA (não quebra nada em produção):
--   - Nenhum template destes kinds existe ainda (purpose novo, sem content_sid
--     real) — o dispatcher não envia nada até alguém cadastrar o template.
--   - Nenhuma flag crm_lc_<kind> está ligada em nenhuma unidade (nasce
--     desligado, como todo o resto do CRM).
--   - Kinds de categoria MARKETING exigem fa_kiosk_guardians.
--     marketing_consent_at_ms, um campo NOVO que ainda não é preenchido por
--     nenhum fluxo — ou seja, candidatos MARKETING serão sempre zero até o
--     produto decidir como coletar esse consentimento (fora do escopo desta
--     migration). Kinds UTILITY reaproveitam whatsapp_consent_at_ms, que já
--     está em uso.
--   - Esta migration NÃO toca fa_checkout, fa_kiosk_sessions nem qualquer
--     função de cobrança.

-- ---------------------------------------------------------------------
-- 1. Consentimento de marketing (separado do consentimento de avisos/NPS)
-- ---------------------------------------------------------------------
alter table fa_kiosk_guardians add column if not exists marketing_consent_at_ms bigint;
alter table fa_kiosk_guardians add column if not exists marketing_consent_by_employee_id uuid references fa_kiosk_employees (id);

-- Mesmo desenho de fa_kiosk_set_whatsapp_consent — chamável do check-in ou de
-- uma tela futura. Nada no app chama esta RPC ainda.
create or replace function fa_kiosk_set_marketing_consent(p_guardian_id uuid, p_consent boolean, p_employee_id uuid default null)
returns void as $$
begin
  update fa_kiosk_guardians
     set marketing_consent_at_ms = case when p_consent then (extract(epoch from now()) * 1000)::bigint else null end,
         marketing_consent_by_employee_id = case when p_consent then p_employee_id else null end
   where id = p_guardian_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_set_marketing_consent(uuid, boolean, uuid) from public, anon;
grant execute on function fa_kiosk_set_marketing_consent(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Purposes novos (a constraint precisa repetir TODOS os valores vigentes)
-- ---------------------------------------------------------------------
alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in (
    'GERAL', 'NPS', 'RENOVACAO', 'OPTIN', 'RELATORIO_SESSAO',
    'VISITA_BOAS_VINDAS', 'VISITA_EXCEDENTE', 'VISITA_RENOVACAO_OK', 'VISITA_FIDELIDADE',
    'MAPEAMENTO',
    'EXPIRACAO', 'RELATORIO_CUPOM', 'PREMIO_FIDELIDADE', 'NPS_PROMOTOR', 'NPS_DETRATOR',
    'UPSELL_PACOTE', 'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'ANIVERSARIO', 'VIP', 'WINBACK'
  ));

-- ---------------------------------------------------------------------
-- 3. Tabela genérica de envio das automações de ciclo de vida
-- ---------------------------------------------------------------------
create table if not exists fa_crm_automation_sends (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references fa_kiosk_units (id),
  kind text not null check (kind in (
    'EXPIRACAO', 'RELATORIO_CUPOM', 'PREMIO_FIDELIDADE', 'NPS_PROMOTOR', 'NPS_DETRATOR',
    'UPSELL_PACOTE', 'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'ANIVERSARIO', 'VIP',
    'WINBACK_1', 'WINBACK_2'
  )),
  contact_id uuid references fa_crm_contacts (id) on delete set null,
  guardian_id uuid references fa_kiosk_guardians (id),
  -- Trava de idempotência do cron (unique com kind), gravada ANTES do envio.
  ref_key text not null,
  payload jsonb,
  twilio_sid text,
  status text not null default 'CLAIMED' check (status in ('CLAIMED', 'SENT', 'FAILED')),
  error text,
  sent_at_ms bigint,
  replied_at_ms bigint,
  reply_payload jsonb,
  converted_order_id uuid references fa_kiosk_orders (id),
  converted_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (kind, ref_key)
);

create index if not exists idx_fa_crm_automation_sends_contact on fa_crm_automation_sends (contact_id, sent_at_ms desc);
create index if not exists idx_fa_crm_automation_sends_guardian on fa_crm_automation_sends (guardian_id, kind);

alter table fa_crm_automation_sends enable row level security;
drop policy if exists fa_crm_automation_sends_read on fa_crm_automation_sends;
create policy fa_crm_automation_sends_read on fa_crm_automation_sends
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- ---------------------------------------------------------------------
-- 4. Guarda de frequência: no máx. 1 marketing a cada 7 dias, 3 em 30 dias.
--    Mensagens UTILITY (expiração, cupom, prêmio, NPS) não contam.
-- ---------------------------------------------------------------------
create or replace function fa_crm_can_send(p_contact_id uuid, p_category text, p_now_ms bigint)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_category <> 'MARKETING' then true else (
    not exists (
      select 1 from fa_crm_automation_sends s
      where s.contact_id = p_contact_id and s.status = 'SENT' and s.sent_at_ms > p_now_ms - 7 * 86400000::bigint
    )
    and (
      select count(*) from fa_crm_automation_sends s
      where s.contact_id = p_contact_id and s.status = 'SENT' and s.sent_at_ms > p_now_ms - 30 * 86400000::bigint
    ) < 3
  ) end
$$;

revoke execute on function fa_crm_can_send(uuid, text, bigint) from public, anon, authenticated;
grant execute on function fa_crm_can_send(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------
-- 5. Candidatos de todos os kinds num UNION ALL só.
--    kind        identificador (mapeia 1:1 para o purpose do template)
--    category    'MARKETING' | 'UTILITY' — decide qual consentimento exigir
--    ref_key     chave de idempotência (sem o prefixo do kind, que já
--                distingue via unique(kind, ref_key))
--    extra       dados variáveis por kind, para o dispatcher montar o texto
-- ---------------------------------------------------------------------
create or replace function fa_crm_lc_candidates(p_now_ms bigint)
returns table (
  kind text, category text, unit_id uuid, guardian_id uuid, guardian_name text, phone_e164 text,
  child_first_name text, activity text, ref_key text, extra jsonb
)
language sql security definer set search_path = public, pg_temp as $$
  with

  -- U2/R4 — Recarga antes de acabar: pacote, crédito ou banco de horas com
  -- saldo baixo (<=30 min) ou vencendo em até 7 dias.
  expiracao as (
    select 'EXPIRACAO'::text as kind, 'UTILITY'::text as category, p.unit_id, p.guardian_id,
           g.full_name, g.phone_e164, null::text as child_first_name, null::text as activity,
           'pkg:' || p.id::text as ref_key,
           jsonb_build_object('sourceKind', 'pacote', 'name', p.package_name_snapshot,
             'remainingMinutes', p.remaining_minutes, 'expiresAtMs', p.expires_at_ms) as extra
    from fa_kiosk_guardian_packages p
    join fa_kiosk_guardians g on g.id = p.guardian_id
    where g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
      and p.expires_at_ms > p_now_ms
      and (p.remaining_minutes <= 30 or p.expires_at_ms <= p_now_ms + 7 * 86400000::bigint)

    union all

    select 'EXPIRACAO', 'UTILITY', c.unit_id, c.guardian_id, g.full_name, g.phone_e164, null, null,
           'credit:' || c.id::text,
           jsonb_build_object('sourceKind', 'saldo pré-pago', 'name', c.source_name_snapshot,
             'remainingMinutes', c.remaining_minutes, 'expiresAtMs', c.expires_at_ms)
    from fa_kiosk_child_time_credits c
    join fa_kiosk_guardians g on g.id = c.guardian_id
    where c.cancelled_at_ms is null and g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
      and c.expires_at_ms > p_now_ms
      and (c.remaining_minutes <= 30 or c.expires_at_ms <= p_now_ms + 7 * 86400000::bigint)

    union all

    select 'EXPIRACAO', 'UTILITY', b.source_unit_id, cg.guardian_id, g.full_name, g.phone_e164, null, null,
           'bank:' || b.id::text,
           jsonb_build_object('sourceKind', 'banco de horas', 'name', b.plan_name_snapshot,
             'remainingMinutes', b.remaining_minutes, 'expiresAtMs', b.expires_at_ms)
    from fa_kiosk_hour_bank_credits b
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = b.child_id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
      and b.expires_at_ms > p_now_ms
      and (b.remaining_minutes <= 30 or b.expires_at_ms <= p_now_ms + 7 * 86400000::bigint)
  ),

  -- C4 — Cupom de retorno para cliente avulso após o relatório de sessão sair.
  relatorio_cupom as (
    select 'RELATORIO_CUPOM', 'UTILITY', r.unit_id, r.guardian_id, g.full_name, g.phone_e164,
           split_part(r.child_name_snapshot, ' ', 1), null,
           'report:' || r.id::text, jsonb_build_object('reportId', r.id)
    from fa_kiosk_session_reports r
    join fa_kiosk_guardians g on g.id = r.guardian_id
    where r.whatsapp_status = 'SENT'
      and r.sent_at_ms between p_now_ms - 3 * 3600000 and p_now_ms - 3600000
      and g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (select 1 from fa_kiosk_guardian_packages p where p.guardian_id = r.guardian_id and p.remaining_minutes > 0 and p.expires_at_ms > p_now_ms)
      and not exists (select 1 from fa_kiosk_child_time_credits c where c.guardian_id = r.guardian_id and c.cancelled_at_ms is null and c.remaining_minutes > 0 and c.expires_at_ms > p_now_ms)
  ),

  -- L2 — Prêmio de fidelidade ganho e não resgatado há 14+ dias.
  premio_fidelidade as (
    select 'PREMIO_FIDELIDADE', 'UTILITY', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), null,
           'reward:' || rw.id::text, jsonb_build_object('rewardId', rw.id)
    from fa_kiosk_loyalty_rewards rw
    join fa_kiosk_children c on c.id = rw.child_id
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = rw.child_id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where rw.redeemed_at_ms is null
      and rw.earned_at_ms between p_now_ms - 60 * 86400000::bigint and p_now_ms - 14 * 86400000::bigint
      and g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
  ),

  -- R2/R3 — Desdobramento do NPS: nota alta pede avaliação, nota baixa avisa
  -- que a gerência vai chamar.
  nps_promotor as (
    select 'NPS_PROMOTOR', 'UTILITY', null::uuid, ct.guardian_id, g.full_name, g.phone_e164, null, null,
           'nps_p:' || s.id::text, jsonb_build_object('surveyId', s.id, 'score', s.score)
    from fa_crm_nps_surveys s
    join fa_crm_contacts ct on ct.id = s.contact_id
    join fa_kiosk_guardians g on g.id = ct.guardian_id
    where s.status = 'SCORED' and s.score >= 9
      and s.scored_at_ms between p_now_ms - 3 * 3600000 and p_now_ms - 5 * 60000
      and g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null

    union all

    select 'NPS_DETRATOR', 'UTILITY', null::uuid, ct.guardian_id, g.full_name, g.phone_e164, null, null,
           'nps_d:' || s.id::text, jsonb_build_object('surveyId', s.id, 'score', s.score)
    from fa_crm_nps_surveys s
    join fa_crm_contacts ct on ct.id = s.contact_id
    join fa_kiosk_guardians g on g.id = ct.guardian_id
    where s.status = 'SCORED' and s.score <= 6
      and s.scored_at_ms between p_now_ms - 3 * 3600000 and p_now_ms - 5 * 60000
      and g.whatsapp_consent_at_ms is not null and g.phone_e164 is not null
  ),

  -- U1 — Pacote pós-visita: sessão avulsa finalizada, cliente recorrente,
  -- sem oferta recente no balcão.
  upsell_pacote as (
    select 'UPSELL_PACOTE', 'MARKETING', s.unit_id, s.guardian_id, g.full_name, g.phone_e164,
           split_part(s.child_name_snapshot, ' ', 1), s.activity,
           'upsell:' || s.id::text, jsonb_build_object('sessionId', s.id)
    from fa_kiosk_sessions s
    join fa_kiosk_guardians g on g.id = s.guardian_id
    where s.status = 'FINALIZADA' and s.checkout_at_ms between p_now_ms - 6 * 3600000 and p_now_ms - 2 * 3600000
      and s.plan_id is not null and not coalesce(s.uses_package, false) and not s.uses_hour_bank
      and not coalesce(s.uses_child_credit, false)
      and g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and (select count(*) from fa_kiosk_visit_log v where v.child_id = s.child_id and v.at_ms > p_now_ms - 30 * 86400000::bigint) >= 2
      and not exists (select 1 from fa_kiosk_upsell_offers o where o.guardian_id = s.guardian_id and o.cooldown_until_ms > p_now_ms)
  ),

  -- C1 — Playground <-> Circuito: frequenta uma atividade, nunca a outra.
  cross_atividade as (
    select 'CROSS_ATIVIDADE', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), 'CARRINHO',
           'cross_act:' || c.id::text, jsonb_build_object('targetActivity', 'CARRINHO')
    from fa_kiosk_children c
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and (select count(*) from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = 'PLAYGROUND' and v.at_ms > p_now_ms - 60 * 86400000::bigint) >= 3
      and not exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = 'CARRINHO' and v.at_ms > p_now_ms - 60 * 86400000::bigint)

    union all

    select 'CROSS_ATIVIDADE', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), 'PLAYGROUND',
           'cross_act:' || c.id::text, jsonb_build_object('targetActivity', 'PLAYGROUND')
    from fa_kiosk_children c
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and (select count(*) from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = 'CARRINHO' and v.at_ms > p_now_ms - 60 * 86400000::bigint) >= 3
      and not exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = 'PLAYGROUND' and v.at_ms > p_now_ms - 60 * 86400000::bigint)
  ),

  -- C2 — Irmão que não vem: responsável com 2+ crianças, só uma frequentando.
  -- Cadência mensal (ref_key inclui o mês) para não repetir toda semana.
  cross_irmao as (
    select 'CROSS_IRMAO', 'MARKETING', null::uuid, g.id, g.full_name, g.phone_e164,
           split_part(active_child.full_name, ' ', 1), null,
           'sibling:' || g.id::text || ':' || to_char(to_timestamp(p_now_ms / 1000.0), 'YYYY-MM'),
           jsonb_build_object('inactiveChildId', inactive.id)
    from fa_kiosk_guardians g
    join lateral (
      select c.id, c.full_name from fa_kiosk_children c
      join fa_kiosk_child_guardians cg on cg.child_id = c.id
      where cg.guardian_id = g.id
        and exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and v.at_ms > p_now_ms - 60 * 86400000::bigint)
      limit 1
    ) active_child on true
    join lateral (
      select c.id from fa_kiosk_children c
      join fa_kiosk_child_guardians cg on cg.child_id = c.id
      where cg.guardian_id = g.id and c.id <> active_child.id
        and not exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and v.at_ms > p_now_ms - 60 * 86400000::bigint)
      limit 1
    ) inactive on true
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
  ),

  -- L3 — Aniversário em até 7 dias. Não duplica com o envio manual existente
  -- (fa_kiosk_birthday_sends).
  aniversario as (
    select 'ANIVERSARIO', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), null,
           'bday:' || c.id::text || ':' || extract(year from next_bday.d)::text,
           jsonb_build_object('childId', c.id, 'birthdayDate', next_bday.d)
    from fa_kiosk_children c
    cross join lateral (
      select case
        when make_date(extract(year from current_date)::int, extract(month from c.birth_date)::int, extract(day from c.birth_date)::int) < current_date
        then make_date(extract(year from current_date)::int + 1, extract(month from c.birth_date)::int, extract(day from c.birth_date)::int)
        else make_date(extract(year from current_date)::int, extract(month from c.birth_date)::int, extract(day from c.birth_date)::int)
      end as d
    ) next_bday
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where c.birth_date is not null
      and next_bday.d between current_date and current_date + 7
      and g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (
        select 1 from fa_kiosk_birthday_sends bs
        where bs.child_id = c.id and bs.year = extract(year from next_bday.d)::int
      )
  ),

  -- L4 — VIP: 8+ visitas em 60 dias. Cadência de ~180 dias via bucket no ref_key.
  vip as (
    select 'VIP', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), null,
           'vip:' || c.id::text || ':' || (p_now_ms / (180 * 86400000::bigint))::text,
           jsonb_build_object('childId', c.id)
    from fa_kiosk_children c
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and (select count(*) from fa_kiosk_visit_log v where v.child_id = c.id and v.at_ms > p_now_ms - 60 * 86400000::bigint) >= 8
  ),

  -- R1 — Winback em 2 toques. Regra fixa (não faz média de intervalo, por
  -- robustez): 1º toque entre 30-90 dias sem visitar; 2º toque só depois do
  -- 1º (21+ dias) e ainda sem visita, até 150 dias de ausência.
  winback as (
    select 'WINBACK_1', 'MARKETING', null::uuid, g.id, g.full_name, g.phone_e164, null, null,
           'w1:' || g.id::text || ':' || (last_visit.at_ms / 86400000::bigint)::text,
           jsonb_build_object('lastVisitAtMs', last_visit.at_ms)
    from fa_kiosk_guardians g
    join lateral (
      select max(s.checkout_at_ms) as at_ms, count(*) as total
      from fa_kiosk_sessions s where s.guardian_id = g.id and s.status = 'FINALIZADA'
    ) last_visit on true
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and last_visit.total >= 3
      and last_visit.at_ms between p_now_ms - 90 * 86400000::bigint and p_now_ms - 30 * 86400000::bigint

    union all

    select 'WINBACK_2', 'MARKETING', null::uuid, g.id, g.full_name, g.phone_e164, null, null,
           'w2:' || g.id::text || ':' || (last_visit.at_ms / 86400000::bigint)::text,
           jsonb_build_object('lastVisitAtMs', last_visit.at_ms)
    from fa_kiosk_guardians g
    join lateral (
      select max(s.checkout_at_ms) as at_ms, count(*) as total
      from fa_kiosk_sessions s where s.guardian_id = g.id and s.status = 'FINALIZADA'
    ) last_visit on true
    join fa_crm_automation_sends w1 on w1.kind = 'WINBACK_1'
      and w1.ref_key = 'w1:' || g.id::text || ':' || (last_visit.at_ms / 86400000::bigint)::text
      and w1.status = 'SENT' and w1.sent_at_ms < p_now_ms - 21 * 86400000::bigint
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and last_visit.total >= 3
      and last_visit.at_ms between p_now_ms - 150 * 86400000::bigint and p_now_ms - 30 * 86400000::bigint
  ),

  all_candidates as (
    select * from expiracao union all select * from relatorio_cupom union all select * from premio_fidelidade
    union all select * from nps_promotor union all select * from upsell_pacote union all select * from cross_atividade
    union all select * from cross_irmao union all select * from aniversario union all select * from vip
    union all select * from winback
  )
  select a.* from all_candidates a
  where a.phone_e164 is not null
    and not exists (select 1 from fa_crm_automation_sends s where s.kind = a.kind and s.ref_key = a.ref_key)
$$;

revoke execute on function fa_crm_lc_candidates(bigint) from public, anon, authenticated;
grant execute on function fa_crm_lc_candidates(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 6. Atribuição de conversão: pedido pago em até 14 dias de um envio SENT
--    sem conversão ainda registrada.
-- ---------------------------------------------------------------------
create or replace function fa_crm_automation_attribute_order() returns trigger as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if new.status = 'PAGA' and (old.status is distinct from 'PAGA') then
    update fa_crm_automation_sends
       set converted_order_id = new.id, converted_at_ms = v_now
     where guardian_id in (select guardian_id from fa_kiosk_sessions where order_id = new.id and guardian_id is not null)
       and status = 'SENT' and converted_order_id is null
       and sent_at_ms > v_now - 14 * 86400000::bigint;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_crm_automation_attribute_order on fa_kiosk_orders;
create trigger trg_fa_crm_automation_attribute_order
  after update on fa_kiosk_orders
  for each row execute function fa_crm_automation_attribute_order();

-- ---------------------------------------------------------------------
-- 7. Cron: a cada 15 min. A janela de horário (10h-20h Belém) é aplicada
--    dentro da Edge Function, não aqui.
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('fa-crm-lifecycle-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'fa-crm-lifecycle-dispatch',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-lifecycle-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
