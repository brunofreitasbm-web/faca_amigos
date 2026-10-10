-- EXPORTADA da produção (supabase_migrations.schema_migrations, versão
-- 20261010045759, aplicada por brunofreitasbm@gmail.com em 2026-10-10). O SQL
-- abaixo é o texto aplicado, sem alterações; só este cabeçalho foi acrescentado
-- para o repositório voltar a refletir a produção. NÃO reaplicar na produção.

-- ============ Tabelas novas (somente service role: RLS ligada, sem policies) ============
create table if not exists public.fa_owner_telegram_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.fa_owner_telegram_config enable row level security;

create table if not exists public.fa_owner_divergence_status (
  notification_id uuid primary key references public.fa_kiosk_owner_notifications(id) on delete cascade,
  status text not null default 'ABERTA' check (status in ('ABERTA','CONFERIDA','JUSTIFICATIVA_PEDIDA','PENDENCIA')),
  updated_by_tg_id bigint,
  updated_by_name text,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.fa_owner_divergence_status enable row level security;

alter table public.fa_kiosk_owner_notifications add column if not exists amount_cents bigint;

insert into public.fa_owner_telegram_config(key, value) values
  ('divergence_threshold', '{"cents": 2000}'::jsonb),
  ('buttons_since', jsonb_build_object('ms', (extract(epoch from now()) * 1000)::bigint))
on conflict (key) do nothing;

-- backfill do valor das divergências de fechamento já existentes (para o ranking semanal)
update public.fa_kiosk_owner_notifications
   set amount_cents = round(replace(substring(body from 'Diferença total: R\$ ([0-9.,]+)'), ',', '')::numeric * 100)::bigint
 where report_type = 'DIVERGENCIA_FECHAMENTO'
   and amount_cents is null
   and body ~ 'Diferença total: R\$ [0-9.,]+';

create or replace function public.fa_owner_telegram_divergence_threshold()
returns bigint language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce((select (value->>'cents')::bigint from fa_owner_telegram_config where key = 'divergence_threshold'), 2000);
$$;

-- ============ Divergências: gravam o valor para permitir o filtro por limiar ============
create or replace function public.fa_owner_report_build_divergencia(p_shift_id uuid)
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_shift record; v_unit record; v_method text;
  v_declared bigint; v_expected bigint; v_diff bigint;
  v_total_abs_diff bigint := 0; v_lines text := ''; v_justificativa text;
begin
  select * into v_shift from fa_kiosk_shifts where id = p_shift_id;
  if v_shift.declared_json is null or v_shift.expected_json is null then
    return;
  end if;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;

  for v_method in
    select distinct key from (
      select jsonb_object_keys(v_shift.declared_json) as key
      union
      select jsonb_object_keys(v_shift.expected_json) as key
    ) k
  loop
    v_declared := coalesce((v_shift.declared_json->>v_method)::bigint, 0);
    v_expected := coalesce((v_shift.expected_json->>v_method)::bigint, 0);
    v_diff := v_declared - v_expected;
    if v_diff <> 0 then
      v_total_abs_diff := v_total_abs_diff + abs(v_diff);
      v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>v_method), '');
      v_lines := v_lines || E'\n' || v_method || ': declarado ' || fa_owner_report_money(v_declared) ||
        ' vs esperado ' || fa_owner_report_money(v_expected) || ' (' ||
        (case when v_diff > 0 then 'sobra de ' else 'falta de ' end) || fa_owner_report_money(abs(v_diff)) || ')' ||
        case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
    end if;
  end loop;

  if coalesce(v_shift.cash_break_cents, 0) <> 0 then
    v_total_abs_diff := v_total_abs_diff + abs(v_shift.cash_break_cents);
    v_justificativa := nullif(trim(coalesce(v_shift.close_justifications_json, '{}'::jsonb)->>'GAVETA'), '');
    v_lines := v_lines || E'\nGAVETA (contagem física): contado ' || fa_owner_report_money(v_shift.counted_cash_cents) ||
      ' vs esperado ' || fa_owner_report_money(v_shift.drawer_expected_cents) || ' (' ||
      (case when v_shift.cash_break_cents > 0 then 'sobra de ' else 'quebra de ' end) || fa_owner_report_money(abs(v_shift.cash_break_cents)) || ')' ||
      case when v_justificativa is not null then E'\n  justificativa: ' || v_justificativa else E'\n  sem justificativa' end;
  end if;

  -- Ignora diferença de centavos de arredondamento (< R$ 1,00 no total).
  if v_total_abs_diff < 100 then
    return;
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência no fechamento — ' || v_unit.name,
    'Diferença total: ' || fa_owner_report_money(v_total_abs_diff) || v_lines,
    'DIVERGENCIA:' || p_shift_id::text
  );

  update fa_kiosk_owner_notifications
     set amount_cents = v_total_abs_diff
   where report_type = 'DIVERGENCIA_FECHAMENTO'
     and dedupe_key = 'DIVERGENCIA:' || p_shift_id::text
     and amount_cents is null;
end;
$function$;

create or replace function public.fa_owner_report_build_divergencia_abertura(p_shift_id uuid)
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_shift record; v_unit record; v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;
  if v_shift.opening_divergence_cents is null or v_shift.opening_divergence_cents = 0 then
    return;
  end if;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'DIVERGENCIA_ABERTURA', v_shift.business_date,
    v_unit.emoji || ' ⚠️ Divergência na abertura — ' || v_unit.name,
    v_operador || ' abriu o caixa às ' ||
      to_char(to_timestamp(v_shift.opened_at_ms / 1000.0) at time zone v_unit.timezone, 'HH24:MI') ||
      fa_owner_report_abertura_conciliacao(p_shift_id),
    'DIVERGENCIA_ABERTURA:' || p_shift_id::text
  );

  update fa_kiosk_owner_notifications
     set amount_cents = abs(v_shift.opening_divergence_cents)
   where report_type = 'DIVERGENCIA_ABERTURA'
     and dedupe_key = 'DIVERGENCIA_ABERTURA:' || p_shift_id::text
     and amount_cents is null;
end;
$function$;

-- ============ Claim do Telegram: limiar de divergência + novos tipos ============
-- (assinatura de retorno inalterada: a versão atual da edge function continua compatível)
create or replace function public.fa_owner_telegram_claim_due(p_now_ms bigint)
 returns table(notification_id uuid, report_type text, title text, body text, photo_url text, due_at_ms bigint)
 language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  -- divergência abaixo do limiar: não vira alerta avulso (continua no corpo do fechamento e no resumo do dia)
  update fa_kiosk_owner_notifications n
     set telegram_sent_at_ms = p_now_ms
   where n.telegram_sent_at_ms is null
     and n.due_at_ms <= p_now_ms
     and n.report_type in ('DIVERGENCIA_ABERTURA', 'DIVERGENCIA_FECHAMENTO')
     and n.amount_cents is not null
     and n.amount_cents < fa_owner_telegram_divergence_threshold();

  return query
  update fa_kiosk_owner_notifications n
     set telegram_sent_at_ms = p_now_ms
   where n.telegram_sent_at_ms is null
     and n.due_at_ms <= p_now_ms
     and n.report_type in (
       'ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_ABERTURA', 'DIVERGENCIA_FECHAMENTO',
       'CANDIDATURA_TALENTOS', 'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA',
       'RESUMO_DIARIO', 'RESUMO_SEMANAL_CONSOLIDADO'
     )
  returning n.id, n.report_type, n.title, n.body, n.photo_url, n.due_at_ms;
end;
$function$;

-- ============ Resumo diário consolidado ============
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
    v_ticket := case when v_pedidos > 0 then round(v_fat::numeric / v_pedidos) else 0 end;

    select count(*), count(*) filter (where status = 'FECHADO') into v_shifts, v_closed
      from fa_kiosk_shifts where unit_id = v_unit.id and business_date = v_date;
    v_fech := case when v_shifts = 0 then 'sem turno'
                   when v_closed = v_shifts then 'ok'
                   else '⚠️ NÃO FECHADO' end;

    select count(*), coalesce(sum(amount_cents), 0), count(*) filter (where body like '%sem justificativa%')
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

  select count(*), coalesce(sum(n.amount_cents), 0) into v_open_n, v_open_cents
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
      ', Ticket médio: ' || fa_owner_report_money(case when v_tot_ped > 0 then round(v_tot_fat::numeric / v_tot_ped) else 0 end) ||
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

create or replace function public.fa_owner_reports_run_diario()
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_local timestamp := now() at time zone 'America/Belem';
begin
  if v_local::time between '23:30' and '23:34:59' then
    perform fa_owner_report_build_resumo_diario(v_local::date);
  end if;
end;
$function$;

-- ============ Relatório semanal consolidado ============
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
      ', Ticket médio: ' || fa_owner_report_money(case when v_ped > 0 then round(v_fat::numeric / v_ped) else 0 end) ||
      ', Meta da semana: ' || case when v_goal > 0 then round(v_fat::numeric / v_goal * 100, 1) || '%' else 'não definida' end;
  end loop;

  for r in
    select g.wd, coalesce(sum(o.total_cents), 0) as c
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

  select count(*), coalesce(sum(amount_cents), 0), count(*) filter (where body like '%sem justificativa%')
    into v_div_n, v_div_cents, v_div_sem
    from fa_kiosk_owner_notifications
    where report_type = 'DIVERGENCIA_FECHAMENTO' and business_date between v_ini and v_fim;

  for r in
    select coalesce(e.full_name, 'Operador não identificado') as nome, count(*) as n, coalesce(sum(n.amount_cents), 0) as c
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
      ', Ticket médio: ' || fa_owner_report_money(case when v_tot_ped > 0 then round(v_tot_fat::numeric / v_tot_ped) else 0 end) ||
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

create or replace function public.fa_owner_reports_run_semanal_consolidado()
 returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_local timestamp := now() at time zone 'America/Belem';
begin
  if extract(isodow from v_local) = 1 and v_local::time between '07:00' and '07:04:59' then
    perform fa_owner_report_build_resumo_semanal_consolidado();
  end if;
end;
$function$;

-- funções novas não ficam expostas via API pública
revoke execute on function public.fa_owner_telegram_divergence_threshold() from public, anon, authenticated;
revoke execute on function public.fa_owner_report_build_resumo_diario(date) from public, anon, authenticated;
revoke execute on function public.fa_owner_reports_run_diario() from public, anon, authenticated;
revoke execute on function public.fa_owner_report_build_resumo_semanal_consolidado() from public, anon, authenticated;
revoke execute on function public.fa_owner_reports_run_semanal_consolidado() from public, anon, authenticated;

-- ============ Agendamento ============
select cron.schedule('fa-owner-report-diario', '*/5 * * * *', 'select public.fa_owner_reports_run_diario();');
select cron.schedule('fa-owner-report-semanal-consolidado', '*/5 * * * *', 'select public.fa_owner_reports_run_semanal_consolidado();');
