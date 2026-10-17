-- MCP somente-leitura (apps/kiosk-ui/api/mcp.ts).
--
-- Cada tool do MCP chama exatamente uma RPC fa_mcp_* abaixo. Todas devolvem
-- apenas AGREGADOS: nenhuma seleciona nome/CPF/nascimento de criança ou
-- responsável, nem texto livre (feedback de NPS, notas, motivos).
-- p_units limita as unidades visíveis (null = todas); quem preenche é a API,
-- a partir do escopo da chave em fa_mcp_api_keys.
--
-- As RPCs só são executáveis pela service_role (a função serverless da Vercel).

create table if not exists fa_mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text not null,
  unit_ids uuid[],                 -- null = todas as unidades
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- RLS ligada e sem policy: só a service_role (que ignora RLS) enxerga a tabela.
alter table fa_mcp_api_keys enable row level security;

-- ---------------------------------------------------------------------------

create or replace function public.fa_mcp_unidades(p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unit_id', u.id, 'nome', u.name, 'tipo', u.kind, 'timezone', u.timezone
  ) order by u.name), '[]'::jsonb)
  from fa_kiosk_units u
  where p_units is null or u.id = any(p_units);
$$;

create or replace function public.fa_mcp_faturamento(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  with ord as (
    select o.id, o.unit_id, o.kind, o.total_cents, o.business_date
      from fa_kiosk_orders o
     where o.status = 'PAGA'
       and o.business_date between p_inicio and p_fim
       and (p_units is null or o.unit_id = any(p_units))
  )
  select jsonb_build_object(
    'por_dia', coalesce((
      select jsonb_agg(d order by d->>'data', d->>'unidade')
        from (
          select jsonb_build_object(
                   'data', ord.business_date,
                   'unit_id', ord.unit_id,
                   'unidade', u.name,
                   'pedidos', count(*),
                   'total_cents', sum(ord.total_cents),
                   'sessoes_cents', coalesce(sum(ord.total_cents) filter (where ord.kind = 'SESSAO'), 0),
                   'pdv_cents', coalesce(sum(ord.total_cents) filter (where ord.kind = 'PDV'), 0)
                 ) as d
            from ord join fa_kiosk_units u on u.id = ord.unit_id
           group by ord.business_date, ord.unit_id, u.name
        ) s
    ), '[]'::jsonb),
    'por_forma_pagamento', coalesce((
      select jsonb_agg(m order by m->>'forma')
        from (
          select jsonb_build_object(
                   'forma', p.method,
                   'pagamentos', count(*),
                   'total_cents', sum(p.amount_cents)
                 ) as m
            from fa_kiosk_payments p join ord on ord.id = p.order_id
           group by p.method
        ) s
    ), '[]'::jsonb)
  );
$$;

create or replace function public.fa_mcp_sessoes(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  with ses as (
    select s.*, pl.name as plano, u.timezone as tz
      from fa_kiosk_sessions s
      join fa_kiosk_plans pl on pl.id = s.plan_id
      join fa_kiosk_units u on u.id = s.unit_id
     where s.business_date between p_inicio and p_fim
       and (p_units is null or s.unit_id = any(p_units))
  )
  select jsonb_build_object(
    'total_sessoes', (select count(*) from ses),
    'por_atividade_plano', coalesce((
      select jsonb_agg(x order by x->>'atividade', x->>'plano')
        from (
          select jsonb_build_object(
                   'atividade', activity, 'plano', plano,
                   'sessoes', count(*),
                   'duracao_media_min', round(avg((checkout_at_ms - checkin_at_ms) / 60000.0)
                                              filter (where checkout_at_ms is not null), 1)
                 ) as x
            from ses group by activity, plano
        ) s
    ), '[]'::jsonb),
    'por_dia_semana', coalesce((
      select jsonb_agg(x order by (x->>'isodow')::int)
        from (
          select jsonb_build_object('isodow', extract(isodow from business_date)::int,
                                    'sessoes', count(*)) as x
            from ses group by 1
        ) s
    ), '[]'::jsonb),
    'por_hora_checkin', coalesce((
      select jsonb_agg(x order by (x->>'hora')::int)
        from (
          select jsonb_build_object(
                   'hora', extract(hour from to_timestamp(checkin_at_ms / 1000.0) at time zone tz)::int,
                   'sessoes', count(*)) as x
            from ses group by 1
        ) s
    ), '[]'::jsonb)
  );
$$;

create or replace function public.fa_mcp_ocupacao_agora(p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(jsonb_agg(x order by x->>'unidade', x->>'atividade'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'unit_id', s.unit_id, 'unidade', u.name, 'atividade', s.activity,
               'ativas', count(*) filter (where s.status = 'ATIVA'),
               'aguardando_pagamento', count(*) filter (where s.status = 'AGUARDANDO_PAGAMENTO')
             ) as x
        from fa_kiosk_sessions s join fa_kiosk_units u on u.id = s.unit_id
       where s.status in ('ATIVA', 'AGUARDANDO_PAGAMENTO')
         and (p_units is null or s.unit_id = any(p_units))
       group by s.unit_id, u.name, s.activity
    ) t;
$$;

create or replace function public.fa_mcp_caixa(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(jsonb_agg(x order by x->>'data', x->>'unidade'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'data', sh.business_date,
               'unit_id', sh.unit_id,
               'unidade', u.name,
               'status', sh.status,
               'abertura_cents', sh.opening_cash_cents,
               'esperado', sh.expected_json,
               'declarado', sh.declared_json,
               'dinheiro_contado_cents', sh.counted_cash_cents,
               'sangrias_cents', coalesce((select sum(m.amount_cents) from fa_kiosk_cash_movements m
                                            where m.shift_id = sh.id and m.kind = 'SANGRIA'), 0),
               'suprimentos_cents', coalesce((select sum(m.amount_cents) from fa_kiosk_cash_movements m
                                               where m.shift_id = sh.id and m.kind = 'SUPRIMENTO'), 0)
             ) as x
        from fa_kiosk_shifts sh join fa_kiosk_units u on u.id = sh.unit_id
       where sh.business_date between p_inicio and p_fim
         and (p_units is null or sh.unit_id = any(p_units))
    ) t;
$$;

create or replace function public.fa_mcp_produtos(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select jsonb_build_object(
    'vendas', coalesce((
      select jsonb_agg(x order by (x->>'total_cents')::bigint desc)
        from (
          select jsonb_build_object(
                   'produto', coalesce(p.name, i.description),
                   'quantidade', sum(i.quantity),
                   'total_cents', sum(i.total_cents)
                 ) as x
            from fa_kiosk_order_items i
            join fa_kiosk_orders o on o.id = i.order_id
            left join fa_kiosk_products p on p.id = i.product_id
           where i.item_type = 'PRODUTO'
             and o.status = 'PAGA'
             and o.business_date between p_inicio and p_fim
             and (p_units is null or o.unit_id = any(p_units))
           group by coalesce(p.name, i.description)
        ) s
    ), '[]'::jsonb),
    'estoque_atual', coalesce((
      select jsonb_agg(jsonb_build_object('unidade', u.name, 'produto', p.name, 'estoque', p.stock)
                       order by u.name, p.name)
        from fa_kiosk_products p join fa_kiosk_units u on u.id = p.unit_id
       where p.active and (p_units is null or p.unit_id = any(p_units))
    ), '[]'::jsonb)
  );
$$;

create or replace function public.fa_mcp_metas(p_data date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(jsonb_agg(x order by x->>'unidade'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'data', p_data,
               'unit_id', u.id,
               'unidade', u.name,
               'meta_cents', fa_kiosk_daily_goal_cents(u.id, p_data),
               'realizado_cents', coalesce((
                  select sum(o.total_cents) from fa_kiosk_orders o
                   where o.unit_id = u.id and o.business_date = p_data and o.status = 'PAGA'), 0),
               'pedidos', (
                  select count(*) from fa_kiosk_orders o
                   where o.unit_id = u.id and o.business_date = p_data and o.status = 'PAGA')
             ) as x
        from fa_kiosk_units u
       where p_units is null or u.id = any(p_units)
    ) t;
$$;

create or replace function public.fa_mcp_nps(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  with r as (
    select n.score, n.score_team, n.score_space
      from fa_crm_nps_surveys n
     where n.score is not null
       and n.scored_at_ms >= (extract(epoch from p_inicio::timestamp at time zone 'America/Belem') * 1000)::bigint
       and n.scored_at_ms <  (extract(epoch from (p_fim + 1)::timestamp at time zone 'America/Belem') * 1000)::bigint
       and (p_units is null or n.unit_id = any(p_units))
  )
  select jsonb_build_object(
    'respostas', (select count(*) from r),
    'nps', (select case when count(*) = 0 then null else
              round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / count(*), 1)
            end from r),
    'promotores', (select count(*) from r where score >= 9),
    'neutros', (select count(*) from r where score between 7 and 8),
    'detratores', (select count(*) from r where score <= 6),
    'media_equipe_1a5', (select round(avg(score_team), 2) from r),
    'media_espaco_1a5', (select round(avg(score_space), 2) from r)
  );
$$;

create or replace function public.fa_mcp_fidelidade(p_inicio date, p_fim date, p_units uuid[] default null)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  with ini as (select (extract(epoch from p_inicio::timestamp at time zone 'America/Belem') * 1000)::bigint as ms),
       fim as (select (extract(epoch from (p_fim + 1)::timestamp at time zone 'America/Belem') * 1000)::bigint as ms)
  select jsonb_build_object(
    'pacotes_vendidos', coalesce((
      select jsonb_agg(x order by x->>'pacote')
        from (
          select jsonb_build_object('pacote', gp.package_name_snapshot,
                                    'quantidade', count(*),
                                    'cobrado_cents', sum(gp.charged_cents)) as x
            from fa_kiosk_guardian_packages gp, ini, fim
           where gp.purchased_at_ms >= ini.ms and gp.purchased_at_ms < fim.ms
             and (p_units is null or gp.unit_id = any(p_units))
           group by gp.package_name_snapshot
        ) s
    ), '[]'::jsonb),
    'creditos_prepagos_em_aberto', (
      select jsonb_build_object('creditos', count(*), 'minutos_restantes', coalesce(sum(remaining_minutes), 0))
        from fa_kiosk_child_time_credits c
       where c.cancelled_at_ms is null and c.remaining_minutes > 0
         and (p_units is null or c.unit_id = any(p_units))
    ),
    'cupons_e_fidelidade', (
      select jsonb_build_object(
               'sessoes_com_cupom', count(*) filter (where s.coupon_id is not null),
               'desconto_cupons_cents', coalesce(sum(s.coupon_discount_cents), 0),
               'sessoes_gratis_fidelidade', count(*) filter (where s.free_from_loyalty))
        from fa_kiosk_sessions s
       where s.business_date between p_inicio and p_fim
         and (p_units is null or s.unit_id = any(p_units))
    )
  );
$$;

-- Execução restrita à service_role.
do $$
declare f text;
begin
  foreach f in array array[
    'fa_mcp_unidades(uuid[])',
    'fa_mcp_faturamento(date,date,uuid[])',
    'fa_mcp_sessoes(date,date,uuid[])',
    'fa_mcp_ocupacao_agora(uuid[])',
    'fa_mcp_caixa(date,date,uuid[])',
    'fa_mcp_produtos(date,date,uuid[])',
    'fa_mcp_metas(date,uuid[])',
    'fa_mcp_nps(date,date,uuid[])',
    'fa_mcp_fidelidade(date,date,uuid[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
