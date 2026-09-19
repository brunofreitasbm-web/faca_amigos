-- =====================================================================
-- Aluguel avulso de pelúcia no Playground — Passo 4 / 4: travas e placar
-- =====================================================================
-- Corpos conferidos via pg_get_functiondef em 2026-09-19.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Troca de plano: aluguel não vira sessão comum nem o contrário.
--    Sem a trava, "Mudar plano" transformaria uma pelúcia em brincadeira
--    (a pelúcia ficaria presa EM_USO e a sessão sairia da regra da
--    bonificação) ou uma brincadeira em pelúcia sem ativo reservado.
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_change_session_plan(p_session_id uuid, p_plan_id uuid, p_package_id uuid default null::uuid)
returns void as $$
declare
  v_session record;
  v_pkg record;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_session from fa_kiosk_sessions where id = p_session_id and status = 'ATIVA';
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;

  if v_session.rental_kind is not null
     or (p_package_id is null and exists (
           select 1 from fa_kiosk_plans where id = p_plan_id and asset_kind is not null and activity = 'PLAYGROUND')) then
    raise exception 'TROCA_PLANO_PELUCIA';
  end if;

  if p_package_id is not null then
    select * into v_pkg from fa_kiosk_packages
      where id = p_package_id and unit_id = v_session.unit_id and activity = v_session.activity and active;
    if not found then raise exception 'PACOTE_INVALIDO'; end if;

    insert into fa_kiosk_guardian_packages (
      unit_id, guardian_id, child_id, package_id, order_id,
      package_name_snapshot, price_cents, charged_cents,
      included_minutes, remaining_minutes, purchased_at_ms, expires_at_ms
    ) values (
      v_session.unit_id, v_session.guardian_id, v_session.child_id, v_pkg.id, null,
      v_pkg.name, v_pkg.price_cents, v_pkg.price_cents,
      v_pkg.included_minutes, v_pkg.included_minutes, v_now_ms,
      v_now_ms + v_pkg.validity_days::bigint * 86400000
    );

    update fa_kiosk_sessions set
      plan_id = null,
      uses_package = true,
      package_id = v_pkg.id,
      package_name_snapshot = v_pkg.name,
      package_price_cents = v_pkg.price_cents,
      package_allocated_minutes = v_pkg.included_minutes,
      package_overage_cents_per_minute = v_pkg.overage_cents_per_minute
    where id = p_session_id and status = 'ATIVA';
    if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;

    perform fa_kiosk_log_session_event(p_session_id, 'TROCA_PLANO', null, jsonb_build_object('newPackageId', v_pkg.id));
  else
    update fa_kiosk_sessions set
      plan_id = p_plan_id,
      uses_package = false,
      package_id = null,
      package_name_snapshot = null,
      package_price_cents = null,
      package_allocated_minutes = null,
      package_overage_cents_per_minute = null
    where id = p_session_id and status = 'ATIVA';
    if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;

    perform fa_kiosk_log_session_event(p_session_id, 'TROCA_PLANO', null, jsonb_build_object('newPlanId', p_plan_id));
  end if;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 2. Cancelar a sessão devolve o ativo. Bug antigo do Circuito (o carrinho
--    ficava EM_USO até alguém liberar à mão); com a pelúcia no balcão do
--    Playground ele travaria o único ativo alugável.
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_cancel_session(p_session_id uuid, p_reason text default null::text)
returns void as $$
declare
  v_asset_id uuid;
begin
  update fa_kiosk_sessions set status = 'FINALIZADA' where id = p_session_id and status = 'ATIVA'
    returning asset_id into v_asset_id;
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;
  if v_asset_id is not null then
    update fa_kiosk_assets set status = 'DISPONIVEL' where id = v_asset_id and status = 'EM_USO';
  end if;
  perform fa_kiosk_log_session_event(p_session_id, 'CANCELADA', null, jsonb_build_object('reason', p_reason));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 3. Push do "Acompanhar": a pelúcia usa a régua do Circuito (aviso aos
--    16 min de 20), não a do Playground (duração - 5).
-- ---------------------------------------------------------------------
create or replace function fa_acompanhar_registrar_push(p_code text, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_plan record;
  v_duration_minutes integer;
  v_alert_minutes integer;
  v_alert_due_at_ms bigint;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    raise exception 'CODIGO_INVALIDO';
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code and status <> 'FINALIZADA';
  if not found then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;
  if v_s.uses_hour_bank then
    raise exception 'NAO_SUPORTADO';
  end if;

  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;
  v_duration_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);

  if v_s.activity = 'CARRINHO' or v_s.rental_kind is not null then
    v_alert_minutes := fa_circuito_alert_at_minutes(v_plan.asset_kind, v_duration_minutes);
    if v_alert_minutes is null then
      raise exception 'NAO_SUPORTADO';
    end if;
  else
    v_alert_minutes := greatest(0, v_duration_minutes - 5);
  end if;

  v_alert_due_at_ms := v_s.checkin_at_ms + coalesce(v_s.paused_ms_total, 0) + (v_alert_minutes::bigint * 60000);

  insert into fa_kiosk_push_subscriptions (session_id, endpoint, p256dh, auth, alert_due_at_ms)
    values (v_s.id, p_endpoint, p_p256dh, p_auth, v_alert_due_at_ms)
    on conflict (session_id, endpoint) do update
      set alert_due_at_ms = excluded.alert_due_at_ms, sent_at_ms = null;

  perform fa_kiosk_log_session_event(v_s.id, 'PUSH_INSCRITO', null, jsonb_build_object('alertDueAtMs', v_alert_due_at_ms));

  return jsonb_build_object('status', 'OK', 'alertDueAtMs', v_alert_due_at_ms);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 4. Quanto do faturamento do dia é aluguel de pelúcia. O placar de
--    bonificação do Painel faz `today_revenue - today_rental` para bater
--    com a apuração oficial (docs/bonificacao/apuracao_bonificacao.sql).
--    Mesmo formato de fa_kiosk_today_revenue.
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_today_rental_cents(p_unit_id uuid, p_business_date text)
returns integer as $$
  select coalesce(sum(oi.total_cents), 0)::integer
    from fa_kiosk_order_items oi
    join fa_kiosk_orders o on o.id = oi.order_id
    join fa_kiosk_sessions s on s.id = oi.session_id
   where o.unit_id = p_unit_id and o.business_date = p_business_date::date and o.status = 'PAGA'
     and s.rental_kind is not null and oi.item_type = 'SESSAO'
$$ language sql stable;

grant execute on function fa_kiosk_today_rental_cents(uuid, text) to authenticated, service_role;
