-- NPS em etapas, dentro do WhatsApp, e o dashboard do Owner.
--
-- Fluxo (tratado em crm-whatsapp-webhook): o template pergunta a UNIDADE
-- visitada (resposta = número da lista); depois o bot pergunta, uma por vez,
-- a recomendação 0-10 (o NPS), a equipe 1-5 e o espaço 1-5; por fim pergunta
-- se o responsável quer deixar uma contribuição (texto livre).
--
-- Estados (fa_crm_nps_surveys.status):
--   SENT    aguardando a unidade (se unit_options) ou a nota 0-10
--   ASKING  nota 0-10 gravada; faltam equipe e/ou espaço
--   SCORED  as 3 notas gravadas; aguardando a contribuição
--   DONE    encerrada          EXPIRED  nunca respondida
--
-- NÃO mexe em fa_crm_lc_candidates: a correção do filtro das réguas
-- NPS_PROMOTOR/NPS_DETRATOR fica em 20261001150000, para depois da régua de
-- ofertas (20261001130000_fa_crm_offer_ladder).

alter table fa_crm_nps_surveys add column if not exists unit_options jsonb;
alter table fa_crm_nps_surveys add column if not exists unit_id uuid references fa_kiosk_units (id);
alter table fa_crm_nps_surveys add column if not exists last_step_ms bigint;
alter table fa_crm_nps_surveys add column if not exists score_team smallint check (score_team between 1 and 5);
alter table fa_crm_nps_surveys add column if not exists score_space smallint check (score_space between 1 and 5);

comment on column fa_crm_nps_surveys.unit_options is
  'Lista [{id,name}] na ordem enviada no template: o número digitado pelo responsável aponta para ela. Nulo = template antigo, sem pergunta de unidade.';
comment on column fa_crm_nps_surveys.last_step_ms is 'Hora da última resposta do responsável; base da janela de 24h entre as etapas.';

create index if not exists idx_fa_crm_nps_unit on fa_crm_nps_surveys (unit_id, sent_at_ms desc);

alter table fa_crm_nps_surveys drop constraint if exists fa_crm_nps_surveys_status_check;
alter table fa_crm_nps_surveys add constraint fa_crm_nps_surveys_status_check
  check (status in ('SENT', 'ASKING', 'SCORED', 'DONE', 'EXPIRED'));

drop index if exists idx_fa_crm_nps_open;
create index idx_fa_crm_nps_open on fa_crm_nps_surveys (contact_id) where status in ('SENT', 'ASKING', 'SCORED');

-- ---------------------------------------------------------------------
-- Feed da Visão Geral Owner: agora com equipe, espaço e unidade.
-- ---------------------------------------------------------------------
drop function if exists fa_crm_nps_feed(integer);
create or replace function fa_crm_nps_feed(p_limit integer default 20)
returns table (id uuid, brand text, score smallint, feedback text, scored_at_ms bigint,
               score_team smallint, score_space smallint, unit_name text) as $$
begin
  if not (fa_kiosk_can('crm.read') or fa_kiosk_can('relatorio.read')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select s.id, c.label, s.score, s.feedback, s.scored_at_ms, s.score_team, s.score_space, u.name
    from fa_crm_nps_surveys s
    join fa_crm_channels c on c.id = s.channel_id
    left join fa_kiosk_units u on u.id = s.unit_id
    where s.score is not null
    order by s.scored_at_ms desc
    limit least(greatest(p_limit, 1), 100);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_nps_feed(integer) from public, anon;
grant execute on function fa_crm_nps_feed(integer) to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard. Eixo de tempo: data de ENVIO da pesquisa (sent_at_ms), no fuso
-- de Belém. Pesquisas recentes ainda podem não ter respondido.
-- ---------------------------------------------------------------------

-- Resumo de um período (interno; só as funções abaixo chamam).
create or replace function fa_crm_nps_period_summary(p_from_ms bigint, p_to_ms bigint, p_unit_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select * from fa_crm_nps_surveys
    where sent_at_ms >= p_from_ms and sent_at_ms < p_to_ms
      and (p_unit_id is null or unit_id = p_unit_id)
  ), agg as (
    select
      count(*)                                  as sent,
      count(unit_id)                            as unit_answered,
      count(score)                              as scored,
      count(score_team)                         as team_answered,
      count(score_space)                        as space_answered,
      count(feedback)                           as commented,
      count(*) filter (where score >= 9)        as promoters,
      count(*) filter (where score between 7 and 8) as passives,
      count(*) filter (where score <= 6)        as detractors,
      avg(score)                                as avg_score,
      avg(score_team)                           as avg_team,
      avg(score_space)                          as avg_space
    from s
  )
  select jsonb_build_object(
    'sent', sent, 'unitAnswered', unit_answered, 'scored', scored,
    'teamAnswered', team_answered, 'spaceAnswered', space_answered, 'commented', commented,
    'promoters', promoters, 'passives', passives, 'detractors', detractors,
    'nps', case when scored = 0 then null else round(((promoters - detractors)::numeric / scored) * 100) end,
    'avgScore', round(avg_score, 2), 'avgTeam', round(avg_team, 2), 'avgSpace', round(avg_space, 2)
  ) from agg
$$;
revoke execute on function fa_crm_nps_period_summary(bigint, bigint, uuid) from public, anon, authenticated;

create or replace function fa_crm_nps_dashboard(p_from_ms bigint, p_to_ms bigint, p_unit_id uuid default null)
returns jsonb as $$
declare
  v_len bigint := p_to_ms - p_from_ms;
  v_bucket text := case when p_to_ms - p_from_ms <= 14 * 86400000::bigint then 'day' else 'week' end;
  v_trend jsonb;
  v_units jsonb;
  v_dist jsonb;
begin
  if not (fa_kiosk_can('crm.read') or fa_kiosk_can('relatorio.read')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_from_ms is null or p_to_ms is null or v_len <= 0 or v_len > 400 * 86400000::bigint then
    raise exception 'PERIODO_INVALIDO';
  end if;

  select coalesce(jsonb_agg(t order by t.bucket), '[]'::jsonb) into v_trend from (
    select
      (date_trunc(v_bucket, to_timestamp(sent_at_ms / 1000.0) at time zone 'America/Belem'))::date::text as bucket,
      count(*) as sent,
      count(score) as scored,
      count(*) filter (where score >= 9) as promoters,
      count(*) filter (where score <= 6) as detractors,
      case when count(score) = 0 then null
           else round(((count(*) filter (where score >= 9) - count(*) filter (where score <= 6))::numeric / count(score)) * 100)
      end as nps
    from fa_crm_nps_surveys
    where sent_at_ms >= p_from_ms and sent_at_ms < p_to_ms
      and (p_unit_id is null or unit_id = p_unit_id)
    group by 1
  ) t;

  select coalesce(jsonb_agg(t order by t.sent desc), '[]'::jsonb) into v_units from (
    select
      s.unit_id,
      coalesce(u.name, 'Não informada') as name,
      count(*) as sent,
      count(s.score) as scored,
      round(avg(s.score_team), 2) as avg_team,
      round(avg(s.score_space), 2) as avg_space,
      case when count(s.score) = 0 then null
           else round(((count(*) filter (where s.score >= 9) - count(*) filter (where s.score <= 6))::numeric / count(s.score)) * 100)
      end as nps
    from fa_crm_nps_surveys s
    left join fa_kiosk_units u on u.id = s.unit_id
    where s.sent_at_ms >= p_from_ms and s.sent_at_ms < p_to_ms
      and (p_unit_id is null or s.unit_id = p_unit_id)
    group by s.unit_id, u.name
  ) t;

  select jsonb_build_object(
    'score', (select jsonb_agg(jsonb_build_object('value', g, 'count',
        (select count(*) from fa_crm_nps_surveys x
          where x.sent_at_ms >= p_from_ms and x.sent_at_ms < p_to_ms
            and (p_unit_id is null or x.unit_id = p_unit_id) and x.score = g)) order by g)
      from generate_series(0, 10) g),
    'team', (select jsonb_agg(jsonb_build_object('value', g, 'count',
        (select count(*) from fa_crm_nps_surveys x
          where x.sent_at_ms >= p_from_ms and x.sent_at_ms < p_to_ms
            and (p_unit_id is null or x.unit_id = p_unit_id) and x.score_team = g)) order by g)
      from generate_series(1, 5) g),
    'space', (select jsonb_agg(jsonb_build_object('value', g, 'count',
        (select count(*) from fa_crm_nps_surveys x
          where x.sent_at_ms >= p_from_ms and x.sent_at_ms < p_to_ms
            and (p_unit_id is null or x.unit_id = p_unit_id) and x.score_space = g)) order by g)
      from generate_series(1, 5) g)
  ) into v_dist;

  return jsonb_build_object(
    'bucket', v_bucket,
    'summary', fa_crm_nps_period_summary(p_from_ms, p_to_ms, p_unit_id),
    'previous', fa_crm_nps_period_summary(p_from_ms - v_len, p_from_ms, p_unit_id),
    'trend', v_trend,
    'byUnit', v_units,
    'distribution', v_dist
  );
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_nps_dashboard(bigint, bigint, uuid) from public, anon;
grant execute on function fa_crm_nps_dashboard(bigint, bigint, uuid) to authenticated;

-- Contribuições e detratores. Nome e telefone do responsável só para quem
-- tem crm.read (o Owner do Gerencial sempre tem).
create or replace function fa_crm_nps_comments(
  p_from_ms bigint,
  p_to_ms bigint,
  p_unit_id uuid default null,
  p_band text default null,            -- PROMOTER | PASSIVE | DETRACTOR
  p_search text default null,
  p_only_with_comment boolean default true,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  id uuid, sent_at_ms bigint, scored_at_ms bigint, unit_id uuid, unit_name text, brand text,
  score smallint, score_team smallint, score_space smallint, feedback text,
  contact_id uuid, contact_name text, contact_phone text
) as $$
declare
  v_can_contact boolean;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (fa_kiosk_can('crm.read') or fa_kiosk_can('relatorio.read')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_band is not null and p_band not in ('PROMOTER', 'PASSIVE', 'DETRACTOR') then
    raise exception 'FAIXA_INVALIDA';
  end if;
  v_can_contact := fa_kiosk_can('crm.read');
  if v_search is not null then
    v_search := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select s.id, s.sent_at_ms, s.scored_at_ms, s.unit_id, u.name, c.label,
           s.score, s.score_team, s.score_space, s.feedback,
           case when v_can_contact then s.contact_id end,
           case when v_can_contact then ct.name end,
           case when v_can_contact then ct.phone_e164 end
    from fa_crm_nps_surveys s
    join fa_crm_channels c on c.id = s.channel_id
    join fa_crm_contacts ct on ct.id = s.contact_id
    left join fa_kiosk_units u on u.id = s.unit_id
    where s.sent_at_ms >= p_from_ms and s.sent_at_ms < p_to_ms
      and (p_unit_id is null or s.unit_id = p_unit_id)
      and (not p_only_with_comment or s.feedback is not null)
      and s.score is not null
      and (p_band is null
           or (p_band = 'PROMOTER' and s.score >= 9)
           or (p_band = 'PASSIVE' and s.score between 7 and 8)
           or (p_band = 'DETRACTOR' and s.score <= 6))
      and (v_search is null or s.feedback ilike v_search escape '\')
    order by coalesce(s.scored_at_ms, s.sent_at_ms) desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_nps_comments(bigint, bigint, uuid, text, text, boolean, integer, integer) from public, anon;
grant execute on function fa_crm_nps_comments(bigint, bigint, uuid, text, text, boolean, integer, integer) to authenticated;
