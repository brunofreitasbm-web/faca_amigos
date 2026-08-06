-- Fase 3: as duas mutações simples de sessão que sobraram em
-- apps/kiosk/src/server/routes/sessions.ts (notificar responsável, trocar
-- plano) — não são transacionais como check-in/checkout, mas gravam em
-- fa_kiosk_session_events, que é insert-only e sem policy de INSERT para
-- "authenticated" (migration 09), então precisam de uma função
-- SECURITY DEFINER também.

create or replace function fa_kiosk_log_session_event(p_session_id uuid, p_kind text, p_employee_id uuid, p_payload jsonb) returns void as $$
  insert into fa_kiosk_session_events (session_id, kind, at_ms, employee_id, payload_json)
  values (p_session_id, p_kind, (extract(epoch from now()) * 1000)::bigint, p_employee_id, p_payload)
$$ language sql security definer;

create or replace function fa_kiosk_change_session_plan(p_session_id uuid, p_plan_id uuid) returns void as $$
begin
  update fa_kiosk_sessions set plan_id = p_plan_id where id = p_session_id and status = 'ATIVA';
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;
  perform fa_kiosk_log_session_event(p_session_id, 'TROCA_PLANO', null, jsonb_build_object('newPlanId', p_plan_id));
end;
$$ language plpgsql security definer;
