-- Cria o plano oficial de 1 hora e meia (90 min) para as unidades do Playground
-- e garante que renovações de +30 min em plano de 1h (e outras durações) sejam
-- sempre aceitas com cálculo de 1h + tempo adicional.

insert into fa_kiosk_plans (
  id, unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active
) values
  ('7a1e0001-0000-4000-8000-000000000090', '11111111-1111-1111-1111-111111111111', 'PLAYGROUND', '1 hora e meia', 26000, 90, 'MINUTO', 300, '#FF8C42', true),
  ('7a1e0001-0000-4000-8000-000000000091', '5fc99a57-81ee-4232-a105-1fcb4634cef4', 'PLAYGROUND', '1 hora e meia', 26000, 90, 'MINUTO', 300, '#FF8C42', true)
on conflict (id) do update set
  name = excluded.name,
  value_cents = excluded.value_cents,
  duration_value = excluded.duration_value,
  duration_unit = excluded.duration_unit,
  overage_cents_per_minute = excluded.overage_cents_per_minute,
  color = excluded.color,
  active = true;

create or replace function fa_kiosk_apply_renewal(p_session_id uuid, p_employee_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session record;
  v_cur record;
  v_last record;
  v_asked integer;
  v_target integer;
  v_new record;
  v_auto_plan_id uuid;
  v_auto_name text;
  v_auto_value integer;
begin
  select * into v_session from fa_kiosk_sessions where id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'SESSAO_NAO_ATIVA'); end if;
  if v_session.status is distinct from 'ATIVA' then
    return jsonb_build_object('status', 'SESSAO_NAO_ATIVA');
  end if;

  select e.kind, e.payload_json into v_last from fa_kiosk_session_events e
   where e.session_id = p_session_id
     and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
   order by e.at_ms desc limit 1;
  if v_last.kind is distinct from 'RENOVACAO_SOLICITADA' then
    return jsonb_build_object('status', 'SEM_PEDIDO');
  end if;

  v_asked := nullif(v_last.payload_json ->> 'minutes', '')::integer;
  if v_asked is null or v_asked <= 0
     or v_session.rental_kind is not null
     or v_session.plan_id is null
     or coalesce(v_session.uses_package, false) then
    return jsonb_build_object('status', 'SEM_PLANO_EQUIVALENTE');
  end if;

  select * into v_cur from fa_kiosk_plans where id = v_session.plan_id;
  v_target := fa_kiosk_plan_duration_minutes(v_cur.duration_value, v_cur.duration_unit) + v_asked;

  -- 1. Procura plano ativo de duração correspondente
  select * into v_new from fa_kiosk_plans p
   where p.unit_id = v_session.unit_id and p.activity = v_session.activity
     and p.active and p.asset_kind is null
     and fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit) = v_target
   order by p.created_at_ms desc limit 1;

  -- 2. Se não existir plano cadastrado para essa duração exata, cria plano sob demanda
  --    (1h + tempo adicional proporcional com base de renovação)
  if v_new.id is null then
    v_auto_name := case
      when v_target = 90 then '1 hora e meia'
      when v_target % 60 = 0 then (v_target / 60) || ' horas'
      else v_target || ' minutos'
    end;
    -- R$ 80,00 de tabela cheia a cada 30 min (equivale a R$ 48,00 após 40% de desconto)
    v_auto_value := v_cur.value_cents + ((v_asked * 8000) / 30);
    
    insert into fa_kiosk_plans (
      unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active
    ) values (
      v_session.unit_id, v_session.activity, v_auto_name, v_auto_value, v_target, 'MINUTO', coalesce(v_cur.overage_cents_per_minute, 300), coalesce(v_cur.color, '#FF8C42'), true
    ) returning * into v_new;
  end if;

  perform fa_kiosk_change_session_plan(p_session_id, v_new.id, null);
  perform fa_kiosk_log_session_event(
    p_session_id, 'RENOVACAO_APLICADA', p_employee_id,
    jsonb_build_object('minutes', v_asked, 'newPlanId', v_new.id, 'auto', true)
  );
  return jsonb_build_object('status', 'OK', 'minutes', v_asked, 'planId', v_new.id, 'planName', v_new.name);
end;
$$;

revoke all on function fa_kiosk_apply_renewal(uuid, uuid) from public, anon;
grant execute on function fa_kiosk_apply_renewal(uuid, uuid) to authenticated, service_role;
