-- 1) sso_tickets_usados: registro de jti (anti-replay) só para service_role, como as tabelas irmãs.
alter table public.sso_tickets_usados enable row level security;
revoke all on table public.sso_tickets_usados from anon, authenticated;

-- 2) search_path fixo nas funções auxiliares (todas as sobrecargas).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'fa_circuito_alert_at_minutes','fa_kiosk_business_date','fa_kiosk_check_idempotency','fa_kiosk_code_alphabet',
        'fa_kiosk_compute_worked_minutes','fa_kiosk_daily_goal_cents','fa_kiosk_guardian_package_balance','fa_kiosk_is_vip',
        'fa_kiosk_last_asset_for_child','fa_kiosk_minutes_until_closing','fa_kiosk_money_br','fa_kiosk_month_start_ms',
        'fa_kiosk_next_order_code','fa_kiosk_normalize_access_code','fa_kiosk_plan_duration_minutes','fa_kiosk_plans_sold',
        'fa_kiosk_random_code','fa_kiosk_search_children','fa_kiosk_session_timing','fa_kiosk_setting_int',
        'fa_kiosk_store_idempotency','fa_kiosk_today_goal_cents','fa_kiosk_today_rental_cents','fa_kiosk_today_revenue',
        'fa_kiosk_today_ticket_medio','fa_kiosk_visit_tier','fa_kiosk_visits_in_window','fa_leads_teste_set_updated_at',
        'fa_now_ms','fa_owner_report_money')
      and p.proconfig is null
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
  end loop;
end $$;

-- 3) Funções internas (trigger/cron/encadeadas) não devem ser chamáveis via /rest/v1/rpc por anon.
-- Todas as chamadoras são SECURITY DEFINER (rodam como dono), então nada quebra.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'fa_crm_automation_attribute_order','fa_owner_notify_google_review_negativa','fa_owner_notify_job_application',
        'fa_owner_notify_ocorrencia','fa_owner_notify_on_shift_change',
        'fa_owner_report_abertura_conciliacao','fa_owner_report_build_abertura','fa_owner_report_build_acompanhamento',
        'fa_owner_report_build_divergencia','fa_owner_report_build_divergencia_abertura','fa_owner_report_build_fechamento',
        'fa_owner_report_build_resumo_semanal','fa_owner_report_enqueue',
        'fa_owner_reports_run_acompanhamento','fa_owner_reports_run_semanal',
        'fa_kiosk_import_legacy_record')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.is_trigger then
      execute format('revoke execute on function %s from authenticated', r.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;
