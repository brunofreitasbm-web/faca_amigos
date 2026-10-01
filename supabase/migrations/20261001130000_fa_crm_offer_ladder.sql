-- Régua de ofertas do CRM: produtos maiores para quem já veio, sem desconto.
--
-- Substitui o UPSELL_PACOTE genérico ("que tal conhecer nossos pacotes") por
-- 3 degraus com produto e gatilho próprios:
--   DEGRAU_2H     saiu de um plano de 30 min/1 h com excedente ou renovação
--   DEGRAU_PORTO  3+ visitas no Playground em 30 dias, sem pacote ativo
--   DEGRAU_DAYUSE quinta-feira, 2+ visitas em 60 dias, sem pacote ativo
-- e reordena a saída de fa_crm_lc_candidates por prioridade, deixando no
-- máximo UM candidato de marketing por responsável em cada rodada (o teto de
-- 1 marketing por semana de fa_crm_can_send só deixa sair um mesmo).
--
-- Resposta às ofertas: os templates novos têm botões "Quero saber mais"
-- (OFERTA_INFO) e "Agora não" (OFERTA_NAO). crm-whatsapp-webhook grava o toque
-- em fa_crm_automation_sends.reply_payload e responde com o texto de
-- fa_crm_offer_info. "Agora não" suspende aquele kind para o responsável por
-- 90 dias.
--
-- Nada sai antes de a Meta aprovar os templates novos
-- (crm-templates-bootstrap) e de alguém ligar as flags crm_lc_degrau_*.

-- ---------------------------------------------------------------------
-- 1. Kinds e purposes novos (as constraints repetem todos os valores vigentes)
-- ---------------------------------------------------------------------
alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in (
    'GERAL', 'NPS', 'RENOVACAO', 'OPTIN', 'RELATORIO_SESSAO',
    'VISITA_BOAS_VINDAS', 'VISITA_EXCEDENTE', 'VISITA_RENOVACAO_OK', 'VISITA_FIDELIDADE',
    'MAPEAMENTO',
    'EXPIRACAO', 'RELATORIO_CUPOM', 'PREMIO_FIDELIDADE', 'NPS_PROMOTOR', 'NPS_DETRATOR',
    'UPSELL_PACOTE', 'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'ANIVERSARIO', 'VIP', 'WINBACK',
    'OPTIN_MARKETING', 'RELATORIO_SESSAO_PDF',
    'DEGRAU_2H', 'DEGRAU_PORTO', 'DEGRAU_DAYUSE'
  ));

alter table fa_crm_automation_sends drop constraint if exists fa_crm_automation_sends_kind_check;
alter table fa_crm_automation_sends add constraint fa_crm_automation_sends_kind_check
  check (kind in (
    'EXPIRACAO', 'RELATORIO_CUPOM', 'PREMIO_FIDELIDADE', 'NPS_PROMOTOR', 'NPS_DETRATOR',
    'UPSELL_PACOTE', 'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'ANIVERSARIO', 'VIP',
    'WINBACK_1', 'WINBACK_2',
    'DEGRAU_2H', 'DEGRAU_PORTO', 'DEGRAU_DAYUSE'
  ));

-- ---------------------------------------------------------------------
-- 1b. Trava de frequência: a versão aplicada em produção tem
--     "30 * 86400000" sem ::bigint, que estoura integer. A função dá erro em
--     TODA chamada (o Postgres dobra a constante ao planejar, inclusive para
--     kinds UTILITY), e o crm-lifecycle-dispatch pula todos os candidatos.
--     É por isso que fa_crm_automation_sends nunca recebeu um envio. Mesma
--     regra de 20260929000000, agora com as constantes em bigint.
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
-- 2. Resposta automática ao "Quero saber mais", por kind. Texto livre (o
--    toque do cliente abre a janela de 24h), editável pelo Owner sem deploy.
--    Preços = os que o balcão pratica (manual-venda-planos-longos.md).
-- ---------------------------------------------------------------------
create table if not exists fa_crm_offer_info (
  kind text primary key,
  reply_text text not null,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_crm_offer_info enable row level security;
drop policy if exists fa_crm_offer_info_read on fa_crm_offer_info;
create policy fa_crm_offer_info_read on fa_crm_offer_info
  for select to authenticated using (fa_kiosk_can('crm.read'));
drop policy if exists fa_crm_offer_info_write on fa_crm_offer_info;
create policy fa_crm_offer_info_write on fa_crm_offer_info
  for all to authenticated using (fa_kiosk_can('crm.admin')) with check (fa_kiosk_can('crm.admin'));

insert into fa_crm_offer_info (kind, reply_text) values
 ('DEGRAU_2H',
  'O plano de 2 horas sai por R$ 192 (meia-entrada R$ 160). É o tempo de almoçar ou resolver as compras no shopping sem ficar de olho no relógio. Para comparar: 1 hora mais 1 hora de minutos extras passa de R$ 210. Para quem fica a tarde toda, o Day Use (R$ 270) libera o dia inteiro, com entrada e saída à vontade. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛'),
 ('DEGRAU_PORTO',
  'O Porto Seguro são 10 horas para usar em 30 dias, por R$ 840 (meia-entrada R$ 700). Sai a R$ 84 a hora, contra R$ 108 da hora avulsa: quem usa as 10 horas no mês economiza R$ 240. Vale em qualquer dia e horário, em visitas do tamanho que vocês quiserem, e os irmãos usam o mesmo saldo. Nada de fila no caixa a cada visita. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛'),
 ('DEGRAU_DAYUSE',
  'O Day Use custa R$ 270 (meia-entrada R$ 225) e vale o dia inteiro: a criança entra e sai quantas vezes quiser e ninguém conta minuto. A partir de 2h45 de brincadeira ele já sai mais em conta que o relógio. Funcionamos das 10h às 22h, todos os dias. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛'),
 ('VIP',
  'O Porto Seguro são 10 horas para usar em 30 dias, por R$ 840 (meia-entrada R$ 700). Para uma família que vem tanto quanto a de vocês, sai a R$ 84 a hora, contra R$ 108 da hora avulsa, e os irmãos usam o mesmo saldo. Sem fila no caixa a cada visita. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛'),
 ('CROSS_ATIVIDADE',
  'O Circuito fica no Parque Shopping, pertinho do Playground: carro ou moto elétrica por 30 minutos e pelúcia ou jeep por 20 minutos, R$ 48 cada. A criança pilota com a nossa equipe acompanhando. Funciona das 10h às 22h. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛'),
 ('WINBACK',
  'O Olhar FaçaAmigos chega no seu WhatsApp depois da visita: um recado da nossa equipe sobre como a criança brincou, se relacionou com as outras e se expressou. Funcionamos das 10h às 22h, todos os dias, no Parque Shopping. É só apresentar esta conversa no balcão ou responder aqui que um atendente reserva pra você. 💛')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------
-- 3. Candidatos. Mesmos CTEs de 20260929000000, exceto:
--    - upsell_pacote sai (substituído pelos degraus);
--    - degrau_2h, degrau_porto, degrau_dayuse entram;
--    - vip e winback passam a levar o primeiro nome da criança ({{2}}) e o
--      vip pula quem já tem pacote ativo (a mensagem oferece o Porto Seguro);
--    - quem tocou "Agora não" num kind fica 90 dias fora dele;
--    - saída ordenada por prioridade, com 1 marketing por responsável.
--    A assinatura (colunas de retorno) não muda.
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

  -- Responsável com saldo vivo (pacote ou crédito pré-pago): não recebe oferta
  -- de produto maior — já comprou.
  has_balance as (
    select p.guardian_id from fa_kiosk_guardian_packages p
    where p.remaining_minutes > 0 and p.expires_at_ms > p_now_ms
    union
    select c.guardian_id from fa_kiosk_child_time_credits c
    where c.cancelled_at_ms is null and c.remaining_minutes > 0 and c.expires_at_ms > p_now_ms
  ),

  -- Degrau 1 — Plano de 2 horas: saiu de um plano de 30 min ou 1 h do
  -- Playground com excedente ou renovação (quis ficar mais). Janela de 1 a
  -- 18 h depois do checkout, para que uma saída à noite ainda seja alcançada
  -- na manhã seguinte (o dispatcher só envia das 10h às 20h). No máximo 1 por
  -- responsável a cada 30 dias.
  degrau_2h as (
    select 'DEGRAU_2H', 'MARKETING', s.unit_id, s.guardian_id, g.full_name, g.phone_e164,
           split_part(s.child_name_snapshot, ' ', 1), s.activity,
           'd2h:' || s.id::text,
           jsonb_build_object('sessionId', s.id, 'overtimeMinutes', s.overtime_minutes)
    from fa_kiosk_sessions s
    join fa_kiosk_plans pl on pl.id = s.plan_id
    join fa_kiosk_guardians g on g.id = s.guardian_id
    where s.status = 'FINALIZADA' and s.activity = 'PLAYGROUND'
      and s.checkout_at_ms between p_now_ms - 18 * 3600000 and p_now_ms - 3600000
      and fa_kiosk_plan_duration_minutes(pl.duration_value, pl.duration_unit) <= 60
      and not coalesce(s.uses_package, false) and not coalesce(s.uses_hour_bank, false)
      and not coalesce(s.uses_child_credit, false)
      and (coalesce(s.overtime_minutes, 0) > 0
           or exists (select 1 from fa_kiosk_session_events e where e.session_id = s.id and e.kind = 'RENOVACAO_APLICADA'))
      and g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (
        select 1 from fa_crm_automation_sends x
        where x.guardian_id = s.guardian_id and x.kind = 'DEGRAU_2H' and x.created_at_ms > p_now_ms - 30 * 86400000::bigint
      )
  ),

  -- Degrau 2 — Porto Seguro: criança com 3+ visitas ao Playground em 30 dias
  -- e família sem pacote/crédito ativo nem oferta recente no balcão. Cadência
  -- de 45 dias (bucket no ref_key).
  degrau_porto as (
    select 'DEGRAU_PORTO', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), 'PLAYGROUND',
           'porto:' || cg.guardian_id::text || ':' || (p_now_ms / (45 * 86400000::bigint))::text,
           jsonb_build_object('childId', c.id, 'visits30d', v.n)
    from fa_kiosk_children c
    join lateral (
      select count(*) as n from fa_kiosk_visit_log vl
      where vl.child_id = c.id and vl.activity = 'PLAYGROUND' and vl.at_ms > p_now_ms - 30 * 86400000::bigint
    ) v on v.n >= 3
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (select 1 from has_balance hb where hb.guardian_id = cg.guardian_id)
      and not exists (select 1 from fa_kiosk_upsell_offers o where o.guardian_id = cg.guardian_id and o.cooldown_until_ms > p_now_ms)
  ),

  -- Degrau 3 — Day Use: só às quintas (Belém), para o fim de semana. Família
  -- com 2+ visitas ao Playground em 60 dias, sem pacote/crédito ativo. Um por
  -- responsável a cada 60 dias.
  degrau_dayuse as (
    select 'DEGRAU_DAYUSE', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), 'PLAYGROUND',
           'dayuse:' || cg.guardian_id::text || ':' || to_char(to_timestamp(p_now_ms / 1000.0) at time zone 'America/Belem', 'IYYY-IW'),
           jsonb_build_object('childId', c.id, 'visits60d', v.n)
    from fa_kiosk_children c
    join lateral (
      select count(*) as n from fa_kiosk_visit_log vl
      where vl.child_id = c.id and vl.activity = 'PLAYGROUND' and vl.at_ms > p_now_ms - 60 * 86400000::bigint
    ) v on v.n >= 2
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where extract(isodow from to_timestamp(p_now_ms / 1000.0) at time zone 'America/Belem') = 4
      and g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (select 1 from has_balance hb where hb.guardian_id = cg.guardian_id)
      and not exists (
        select 1 from fa_crm_automation_sends x
        where x.guardian_id = cg.guardian_id and x.kind = 'DEGRAU_DAYUSE' and x.created_at_ms > p_now_ms - 60 * 86400000::bigint
      )
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


  -- L4 — VIP: 8+ visitas ao Playground em 60 dias. Cadência de ~180 dias via
  -- bucket no ref_key. A mensagem apresenta o Porto Seguro (pacote do
  -- Playground): conta só visitas ao Playground e pula quem já tem saldo.
  vip as (
    select 'VIP', 'MARKETING', null::uuid, cg.guardian_id, g.full_name, g.phone_e164,
           split_part(c.full_name, ' ', 1), null,
           'vip:' || c.id::text || ':' || (p_now_ms / (180 * 86400000::bigint))::text,
           jsonb_build_object('childId', c.id)
    from fa_kiosk_children c
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and not exists (select 1 from has_balance hb where hb.guardian_id = cg.guardian_id)
      and (select count(*) from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = 'PLAYGROUND' and v.at_ms > p_now_ms - 60 * 86400000::bigint) >= 8
  ),

  -- R1 — Winback em 2 toques (mesma regra de antes), agora com o primeiro
  -- nome da criança da última visita.
  winback as (
    select 'WINBACK_1', 'MARKETING', null::uuid, g.id, g.full_name, g.phone_e164,
           split_part(last_visit.child_name, ' ', 1), null,
           'w1:' || g.id::text || ':' || (last_visit.at_ms / 86400000::bigint)::text,
           jsonb_build_object('lastVisitAtMs', last_visit.at_ms)
    from fa_kiosk_guardians g
    join lateral (
      select max(s.checkout_at_ms) as at_ms, count(*) as total,
             (array_agg(s.child_name_snapshot order by s.checkout_at_ms desc))[1] as child_name
      from fa_kiosk_sessions s where s.guardian_id = g.id and s.status = 'FINALIZADA'
    ) last_visit on true
    where g.marketing_consent_at_ms is not null and g.phone_e164 is not null
      and last_visit.total >= 3
      and last_visit.at_ms between p_now_ms - 90 * 86400000::bigint and p_now_ms - 30 * 86400000::bigint

    union all

    select 'WINBACK_2', 'MARKETING', null::uuid, g.id, g.full_name, g.phone_e164,
           split_part(last_visit.child_name, ' ', 1), null,
           'w2:' || g.id::text || ':' || (last_visit.at_ms / 86400000::bigint)::text,
           jsonb_build_object('lastVisitAtMs', last_visit.at_ms)
    from fa_kiosk_guardians g
    join lateral (
      select max(s.checkout_at_ms) as at_ms, count(*) as total,
             (array_agg(s.child_name_snapshot order by s.checkout_at_ms desc))[1] as child_name
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
    union all select * from nps_promotor union all select * from degrau_2h union all select * from degrau_porto
    union all select * from degrau_dayuse union all select * from cross_atividade
    union all select * from cross_irmao union all select * from aniversario union all select * from vip
    union all select * from winback
  ),

  eligible as (
    select a.*,
           case a.kind
             when 'DEGRAU_2H' then 1 when 'DEGRAU_PORTO' then 2 when 'VIP' then 3
             when 'DEGRAU_DAYUSE' then 4 when 'CROSS_ATIVIDADE' then 5 when 'ANIVERSARIO' then 6
             when 'CROSS_IRMAO' then 7 when 'WINBACK_1' then 8 when 'WINBACK_2' then 8
             else 0
           end as priority
    from all_candidates a
    where a.phone_e164 is not null
      and not exists (select 1 from fa_crm_automation_sends s where s.kind = a.kind and s.ref_key = a.ref_key)
      -- "Agora não": 90 dias sem aquele kind (os dois toques do winback contam juntos).
      and not exists (
        select 1 from fa_crm_automation_sends s
        where s.guardian_id = a.guardian_id
          and (s.kind = a.kind or (s.kind like 'WINBACK_%' and a.kind like 'WINBACK_%'))
          and s.reply_payload ->> 'button' = 'OFERTA_NAO'
          and s.replied_at_ms > p_now_ms - 90 * 86400000::bigint
      )
  ),

  ranked as (
    select e.*,
           row_number() over (partition by e.guardian_id, (e.category = 'MARKETING') order by e.priority, e.ref_key) as rn
    from eligible e
  )
  select r.kind, r.category, r.unit_id, r.guardian_id, r.full_name, r.phone_e164,
         r.child_first_name, r.activity, r.ref_key, r.extra
  from ranked r
  where r.category <> 'MARKETING' or r.rn = 1
  order by r.priority, r.ref_key
$$;

revoke execute on function fa_crm_lc_candidates(bigint) from public, anon, authenticated;
grant execute on function fa_crm_lc_candidates(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 4. Flags. Os degraus herdam o liga/desliga do UPSELL_PACOTE (que sai de
--    cena). ANIVERSARIO desliga: a mensagem promete "algo especial" que não
--    existe como produto. CROSS_IRMAO desliga: o argumento que vende ("irmãos
--    usam o mesmo saldo") foi para as mensagens do Porto Seguro.
-- ---------------------------------------------------------------------
insert into fa_kiosk_app_settings (unit_id, key, value, updated_at_ms)
select s.unit_id, k.key, s.value, (extract(epoch from now()) * 1000)::bigint
from fa_kiosk_app_settings s
cross join (values ('crm_lc_degrau_2h'), ('crm_lc_degrau_porto'), ('crm_lc_degrau_dayuse')) as k(key)
where s.key = 'crm_lc_upsell_pacote'
on conflict do nothing;

update fa_kiosk_app_settings set value = '0', updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where key in ('crm_lc_upsell_pacote', 'crm_lc_aniversario', 'crm_lc_cross_irmao');

-- ---------------------------------------------------------------------
-- 5. Aposenta os templates v1 que as versões novas substituem. O dispatcher
--    usa o template ativo mais novo de cada purpose; sem isto, VIP v1
--    ("prioridade no pré-check-in", benefício que não existe) continuaria
--    saindo até a Meta aprovar a v2. crm-templates-bootstrap não reativa
--    nomes aposentados (lista RETIRED).
-- ---------------------------------------------------------------------
update fa_crm_templates set active = false
 where name in ('fa_lc_upsell_pacote', 'fa_lc_cross_atividade', 'fa_lc_vip', 'fa_lc_winback');
