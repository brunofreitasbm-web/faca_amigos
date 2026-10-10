-- EXPORTADA da produção (supabase_migrations.schema_migrations, versão
-- 20261010045834, aplicada por brunofreitasbm@gmail.com em 2026-10-10). O SQL
-- abaixo é o texto aplicado, sem alterações; só este cabeçalho foi acrescentado
-- para o repositório voltar a refletir a produção. NÃO reaplicar na produção.

create or replace function public.fa_owner_report_build_resumo_diario(p_business_date date default null)
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_date date := coalesce(p_business_date, (now() at time zone 'America/Belem')::date);
  v_wd text[] := array['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  v_unit record;
  v_lines text := '';
  v_fat bigint; v_pedidos int; v_visitas int; v_goal bigint; v_ticket bigint;
  v_tot_fat bigint := 0; v_tot_ped int := 0; v_tot_vis int := 0; v_tot_ant bigint; v_var numeric;
  v_shifts int; v_closed int; v_fech text;
  v_div_n int; v_div_cents bigint; v_div_sem int; v_div_txt text;
  v_open_n int; v_open_cents bigint;
  v_since bigint := coalesce((select (value->>'ms')::bigint from fa_owner_telegram_config where key = 'buttons_since'), 0);
  v_body text;
begin
  for v_unit in select * from fa_kiosk_units order by name loop
    select coalesce(sum(total_cents), 0), count(*) into v_fat, v_pedidos
      from fa_kiosk_orders where unit_id = v_unit.id and business_date = v_date and status = 'PAGA';
    select count(*) into v_visitas
      from fa_kiosk_sessions
      where unit_id = v_unit.id
        and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_date;
    v_goal := fa_kiosk_daily_goal_cents(v_unit.id, v_date);
    v_ticket := case when v_pedidos > 0 then round(v_fat::numeric / v_pedidos)::bigint else 0 end;

    select count(*), count(*) filter (where status = 'FECHADO') into v_shifts, v_closed
      from fa_kiosk_shifts where unit_id = v_unit.id and business_date = v_date;
    v_fech := case when v_shifts = 0 then 'sem turno'
                   when v_closed = v_shifts then 'ok'
                   else '⚠️ NÃO FECHADO' end;

    select count(*), coalesce(sum(amount_cents), 0)::bigint, count(*) filter (where body like '%sem justificativa%')
      into v_div_n, v_div_cents, v_div_sem
      from fa_kiosk_owner_notifications
      where unit_id = v_unit.id and business_date = v_date and report_type = 'DIVERGENCIA_FECHAMENTO';
    v_div_txt := case when v_div_n = 0 then 'nenhuma'
                      else fa_owner_report_money(v_div_cents) || ' (' || v_div_sem || ' sem justificativa)' end;

    v_tot_fat := v_tot_fat + v_fat;
    v_tot_ped := v_tot_ped + v_pedidos;
    v_tot_vis := v_tot_vis + v_visitas;

    v_lines := v_lines || E'\n' || coalesce(v_unit.emoji, '🏠') || ' ' || v_unit.name || ' — Faturado: ' || fa_owner_report_money(v_fat) ||
      ', Meta: ' || case when v_goal > 0 then round(v_fat::numeric / v_goal * 100, 1) || '%' else 'não definida' end ||
      ', Sessões: ' || v_visitas ||
      ', Ticket médio: ' || fa_owner_report_money(v_ticket) ||
      ', Fechamento: ' || v_fech ||
      ', Divergência: ' || v_div_txt;
  end loop;

  select coalesce(sum(total_cents), 0) into v_tot_ant
    from fa_kiosk_orders where business_date = v_date - 7 and status = 'PAGA';
  v_var := case when v_tot_ant > 0 then round((v_tot_fat - v_tot_ant)::numeric / v_tot_ant * 100, 1) else null end;

  select count(*), coalesce(sum(n.amount_cents), 0)::bigint into v_open_n, v_open_cents
    from fa_kiosk_owner_notifications n
    left join fa_owner_divergence_status s on s.notification_id = n.id
    where n.report_type in ('DIVERGENCIA_FECHAMENTO', 'DIVERGENCIA_ABERTURA')
      and n.created_at_ms >= v_since
      and n.amount_cents >= fa_owner_telegram_divergence_threshold()
      and coalesce(s.status, 'ABERTA') <> 'CONFERIDA';

  v_body := 'Data: ' || to_char(v_date, 'DD/MM/YYYY') || ' (' || v_wd[extract(dow from v_date)::int + 1] || ')' ||
    v_lines ||
    E'\nTOTAL — Faturado: ' || fa_owner_report_money(v_tot_fat) ||
      ', vs mesmo dia da semana anterior: ' ||
        case when v_var is null then 'sem base'
             else (case when v_var >= 0 then '+' else '' end) || v_var || '%' end ||
      ', Sessões: ' || v_tot_vis ||
      ', Ticket médio: ' || fa_owner_report_money(case when v_tot_ped > 0 then round(v_tot_fat::numeric / v_tot_ped)::bigint else 0 end) ||
    E'\nDivergências em aberto (não conferidas): ' ||
      case when v_open_n = 0 then 'nenhuma' else v_open_n || ' — ' || fa_owner_report_money(v_open_cents) end;

  perform fa_owner_report_enqueue(
    null, 'RESUMO_DIARIO', v_date,
    '📊 Resumo do dia — ' || to_char(v_date, 'DD/MM'),
    v_body,
    'RESUMO_DIARIO:' || v_date::text
  );
end;
$function$;

create or replace function public.fa_owner_report_build_resumo_semanal_consolidado()
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_hoje date := (now() at time zone 'America/Belem')::date;
  v_fim date; v_ini date; v_ant_fim date; v_ant_ini date;
  v_wdn text[] := array['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  v_unit record; r record;
  v_lines text := '';
  v_fat bigint; v_fat_ant bigint; v_vis int; v_vis_ant int; v_ped int; v_goal bigint;
  v_var_f numeric; v_var_v numeric;
  v_tot_fat bigint := 0; v_tot_fat_ant bigint := 0; v_tot_vis int := 0; v_tot_ped int := 0;
  v_days text := ''; v_uteis bigint := 0; v_all bigint := 0;
  v_rank text := '';
  v_div_n int; v_div_cents bigint; v_div_sem int;
  v_body text;
begin
  v_fim := v_hoje - 1;
  v_ini := v_fim - 6;
  v_ant_fim := v_ini - 1;
  v_ant_ini := v_ant_fim - 6;

  for v_unit in select * from fa_kiosk_units order by name loop
    select coalesce(sum(total_cents), 0), count(*) into v_fat, v_ped
      from fa_kiosk_orders where unit_id = v_unit.id and business_date between v_ini and v_fim and status = 'PAGA';
    select coalesce(sum(total_cents), 0) into v_fat_ant
      from fa_kiosk_orders where unit_id = v_unit.id and business_date between v_ant_ini and v_ant_fim and status = 'PAGA';
    select count(*) into v_vis
      from fa_kiosk_sessions where unit_id = v_unit.id
        and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date between v_ini and v_fim;
    select count(*) into v_vis_ant
      from fa_kiosk_sessions where unit_id = v_unit.id
        and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date between v_ant_ini and v_ant_fim;
    select coalesce(sum(fa_kiosk_daily_goal_cents(v_unit.id, d::date)), 0) into v_goal
      from generate_series(v_ini::timestamp, v_fim::timestamp, interval '1 day') d;

    v_var_f := case when v_fat_ant > 0 then round((v_fat - v_fat_ant)::numeric / v_fat_ant * 100, 1) else null end;
    v_var_v := case when v_vis_ant > 0 then round((v_vis - v_vis_ant)::numeric / v_vis_ant * 100, 1) else null end;

    v_tot_fat := v_tot_fat + v_fat; v_tot_fat_ant := v_tot_fat_ant + v_fat_ant;
    v_tot_vis := v_tot_vis + v_vis; v_tot_ped := v_tot_ped + v_ped;

    v_lines := v_lines || E'\n' || coalesce(v_unit.emoji, '🏠') || ' ' || v_unit.name || ' — Faturado: ' || fa_owner_report_money(v_fat) ||
      case when v_var_f is not null then ' (' || (case when v_var_f >= 0 then '+' else '' end) || v_var_f || '%)' else '' end ||
      ', Sessões: ' || v_vis ||
      case when v_var_v is not null then ' (' || (case when v_var_v >= 0 then '+' else '' end) || v_var_v || '%)' else '' end ||
      ', Ticket médio: ' || fa_owner_report_money(case when v_ped > 0 then round(v_fat::numeric / v_ped)::bigint else 0 end) ||
      ', Meta da semana: ' || case when v_goal > 0 then round(v_fat::numeric / v_goal * 100, 1) || '%' else 'não definida' end;
  end loop;

  for r in
    select g.wd, coalesce(sum(o.total_cents), 0)::bigint as c
      from generate_series(1, 7) g(wd)
      left join fa_kiosk_orders o
        on extract(isodow from o.business_date) = g.wd
       and o.business_date between v_ini and v_fim
       and o.status = 'PAGA'
      group by g.wd order by g.wd
  loop
    v_days := v_days || case when v_days = '' then '' else ', ' end || v_wdn[r.wd] || ': ' || fa_owner_report_money(r.c);
    v_all := v_all + r.c;
    if r.wd <= 5 then v_uteis := v_uteis + r.c; end if;
  end loop;

  select count(*), coalesce(sum(amount_cents), 0)::bigint, count(*) filter (where body like '%sem justificativa%')
    into v_div_n, v_div_cents, v_div_sem
    from fa_kiosk_owner_notifications
    where report_type = 'DIVERGENCIA_FECHAMENTO' and business_date between v_ini and v_fim;

  for r in
    select coalesce(e.full_name, 'Operador não identificado') as nome, count(*) as n, coalesce(sum(n.amount_cents), 0)::bigint as c
      from fa_kiosk_owner_notifications n
      left join fa_kiosk_shifts s
        on s.id = case when n.dedupe_key ~ '^DIVERGENCIA:[0-9a-f-]{36}$' then substring(n.dedupe_key from 13)::uuid end
      left join fa_kiosk_employees e on e.id = coalesce(s.closed_by_employee_id, s.opened_by_employee_id)
      where n.report_type = 'DIVERGENCIA_FECHAMENTO' and n.business_date between v_ini and v_fim
      group by 1 order by 3 desc limit 5
  loop
    v_rank := v_rank || case when v_rank = '' then '' else ', ' end || r.nome || ': ' || fa_owner_report_money(r.c) || ' (' || r.n || ')';
  end loop;

  v_body := 'Semana: ' || to_char(v_ini, 'DD/MM') || ' a ' || to_char(v_fim, 'DD/MM') ||
    v_lines ||
    E'\nTOTAL — Faturado: ' || fa_owner_report_money(v_tot_fat) ||
      case when v_tot_fat_ant > 0
           then ' (' || (case when v_tot_fat >= v_tot_fat_ant then '+' else '' end) || round((v_tot_fat - v_tot_fat_ant)::numeric / v_tot_fat_ant * 100, 1) || '% vs semana anterior)'
           else '' end ||
      ', Sessões: ' || v_tot_vis ||
      ', Ticket médio: ' || fa_owner_report_money(case when v_tot_ped > 0 then round(v_tot_fat::numeric / v_tot_ped)::bigint else 0 end) ||
    E'\nFaturado por dia da semana — ' || v_days ||
    E'\nDias úteis (seg-sex): ' || case when v_all > 0 then round(v_uteis::numeric / v_all * 100, 1) || '% do faturado' else 'sem faturamento' end ||
    E'\nDivergências na semana: ' || case when v_div_n = 0 then 'nenhuma'
                                          else v_div_n || ' — ' || fa_owner_report_money(v_div_cents) || ' (' || v_div_sem || ' sem justificativa)' end ||
    case when v_rank <> '' then E'\nDivergências por operador — ' || v_rank else '' end;

  perform fa_owner_report_enqueue(
    null, 'RESUMO_SEMANAL_CONSOLIDADO', v_hoje,
    '📈 Semana consolidada — ' || to_char(v_ini, 'DD/MM') || ' a ' || to_char(v_fim, 'DD/MM'),
    v_body,
    'RESUMO_SEMANAL_CONSOLIDADO:' || v_ini::text
  );
end;
$function$;
