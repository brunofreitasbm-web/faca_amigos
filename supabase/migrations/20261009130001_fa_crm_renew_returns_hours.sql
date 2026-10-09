-- Atualiza as RPCs de renovação para devolverem os horários de fechamento da
-- unidade, permitindo que o webhook de WhatsApp calcule o lembrete de
-- fechamento do shopping corretamente.

create or replace function fa_crm_renewal_choose(p_contact_id uuid, p_choice integer, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alert record;
  v_opt jsonb;
  v_status text;
  v_unit_id uuid;
  v_unit record;
begin
  select * into v_alert from fa_crm_renewal_alerts
   where contact_id = p_contact_id and sent_at_ms > p_now_ms - 2 * 3600 * 1000
   order by sent_at_ms desc limit 1
   for update;
  if not found then return jsonb_build_object('status', 'NONE'); end if;

  v_opt := v_alert.options -> (p_choice - 1);
  if v_opt is null then return jsonb_build_object('status', 'NONE'); end if;
  if v_alert.chosen_at_ms is not null then return jsonb_build_object('status', 'ALREADY'); end if;

  select status, unit_id into v_status, v_unit_id from fa_kiosk_sessions where id = v_alert.session_id;
  if v_status is distinct from 'ATIVA' and v_status is distinct from 'PAUSADA' then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  select * into v_unit from fa_kiosk_units where id = v_unit_id;

  update fa_crm_renewal_alerts set chosen_index = p_choice, chosen_at_ms = p_now_ms where id = v_alert.id;
  perform fa_kiosk_log_session_event(
    v_alert.session_id, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int, 'via', 'WHATSAPP', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int, 'closingHourMonSat', v_unit.closing_hour_mon_sat, 'closingHourSun', v_unit.closing_hour_sun);
end;
$$;

create or replace function fa_crm_overage_renew(p_contact_id uuid, p_choice integer, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alert record;
  v_opt jsonb;
  v_status text;
  v_unit_id uuid;
  v_unit record;
begin
  select * into v_alert from fa_crm_overage_alerts
   where contact_id = p_contact_id and sent_at_ms > p_now_ms - 2 * 3600 * 1000
   order by sent_at_ms desc limit 1
   for update;
  if not found then return jsonb_build_object('status', 'NONE'); end if;

  v_opt := v_alert.options -> (p_choice - 1);
  if v_opt is null then return jsonb_build_object('status', 'NONE'); end if;
  if v_alert.chosen_at_ms is not null then return jsonb_build_object('status', 'ALREADY'); end if;

  select status, unit_id into v_status, v_unit_id from fa_kiosk_sessions where id = v_alert.session_id;
  if v_status is distinct from 'ATIVA' and v_status is distinct from 'PAUSADA' then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  select * into v_unit from fa_kiosk_units where id = v_unit_id;

  update fa_crm_overage_alerts set chosen_index = p_choice, chosen_at_ms = p_now_ms where id = v_alert.id;
  perform fa_kiosk_log_session_event(
    v_alert.session_id, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int, 'via', 'WHATSAPP', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', (v_opt ->> 'minutes')::int, 'cents', (v_opt ->> 'cents')::int, 'closingHourMonSat', v_unit.closing_hour_mon_sat, 'closingHourSun', v_unit.closing_hour_sun);
end;
$$;

create or replace function fa_crm_renew_request(p_contact_id uuid, p_minutes integer, p_child_hint text, p_now_ms bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guardian uuid;
  v_ids uuid[];
  v_session uuid;
  v_cents integer;
  v_last text;
  v_unit_id uuid;
  v_unit record;
begin
  v_cents := case p_minutes when 30 then 4800 when 60 then 9600 else (p_minutes * 160 / 100) * 100 end;
  if v_cents is null then return jsonb_build_object('status', 'INVALID'); end if;

  select coalesce(c.guardian_id, (select g.id from fa_kiosk_guardians g where g.phone_e164 = c.phone_e164 limit 1))
    into v_guardian
    from fa_crm_contacts c where c.id = p_contact_id;
  if v_guardian is null then return jsonb_build_object('status', 'NO_SESSION'); end if;

  select array_agg(s.id order by s.checkin_at_ms desc) into v_ids
    from fa_kiosk_sessions s
   where s.guardian_id = v_guardian and s.status in ('ATIVA', 'PAUSADA') and s.activity = 'PLAYGROUND';
  if v_ids is null then return jsonb_build_object('status', 'NO_SESSION'); end if;

  if array_length(v_ids, 1) = 1 then
    v_session := v_ids[1];
  else
    select s.id into v_session from fa_kiosk_sessions s
     where s.id = any (v_ids) and nullif(trim(p_child_hint), '') is not null
       and lower(s.child_name_snapshot) like lower(trim(p_child_hint)) || '%'
     order by s.checkin_at_ms desc limit 1;
    if v_session is null then return jsonb_build_object('status', 'AMBIGUOUS'); end if;
  end if;

  perform 1 from fa_kiosk_sessions where id = v_session for update;

  select e.kind into v_last from fa_kiosk_session_events e
   where e.session_id = v_session and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
   order by e.at_ms desc limit 1;
  if v_last = 'RENOVACAO_SOLICITADA' then return jsonb_build_object('status', 'ALREADY'); end if;

  select unit_id into v_unit_id from fa_kiosk_sessions where id = v_session;
  select * into v_unit from fa_kiosk_units where id = v_unit_id;

  perform fa_kiosk_log_session_event(
    v_session, 'RENOVACAO_SOLICITADA', null,
    jsonb_build_object('minutes', p_minutes, 'cents', v_cents, 'via', 'WHATSAPP', 'origin', 'TELA', 'requestedAtMs', p_now_ms)
  );
  return jsonb_build_object('status', 'OK', 'minutes', p_minutes, 'cents', v_cents, 'closingHourMonSat', v_unit.closing_hour_mon_sat, 'closingHourSun', v_unit.closing_hour_sun);
end;
$$;
