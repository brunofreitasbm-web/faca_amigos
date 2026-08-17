-- O menu Gerencial > Auditoria (fa_gerencial_audit_log, migration 050000) só
-- tinha o que mostrar para alterações de configuração (fa_config_audit) —
-- ponto, entrada/saída e caixa nunca escreviam em fa_kiosk_audit_log, então
-- a tela ficava vazia mesmo com operador em atividade o dia inteiro.
--
-- Em vez de editar cada RPC de operação (fa_register_ponto, fa_checkin,
-- fa_checkout, fa_close_shift, ...) — arriscado por serem funções grandes e
-- redefinidas em várias migrations — a captura é por trigger AFTER
-- INSERT/UPDATE nas tabelas que essas RPCs já escrevem. Cobre também
-- qualquer chamador futuro que escreva direto nessas tabelas, não só as
-- RPCs de hoje.
--
-- Os triggers rodam dentro da mesma transação/security-definer da RPC que
-- disparou o INSERT/UPDATE, então current_setting/fa_kiosk_current_employee_id
-- ainda enxerga o funcionário autenticado quando a tabela não guarda o autor
-- explicitamente (caso do cancelamento de sessão).

-- ---------------------------------------------------------------------------
-- Ponto
-- ---------------------------------------------------------------------------
create or replace function fa_kiosk_audit_ponto_trg() returns trigger as $$
begin
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.employee_id,
    'PONTO_' || new.kind,
    'INFO',
    jsonb_build_object(
      'pontoId', new.id,
      'unitId', new.unit_id,
      'nsr', new.nsr,
      'atMs', new.at_ms,
      'registeredByEmployeeId', new.registered_by_employee_id
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_ponto on fa_kiosk_ponto_records;
create trigger trg_fa_kiosk_audit_ponto
  after insert on fa_kiosk_ponto_records
  for each row execute function fa_kiosk_audit_ponto_trg();

-- ---------------------------------------------------------------------------
-- Entrada/Saída (sessões)
-- ---------------------------------------------------------------------------
create or replace function fa_kiosk_audit_session_checkin_trg() returns trigger as $$
begin
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.checkin_by_employee_id,
    'ENTRADA_CHECKIN',
    'INFO',
    jsonb_build_object(
      'sessionId', new.id,
      'unitId', new.unit_id,
      'activity', new.activity,
      'childName', new.child_name_snapshot
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_session_checkin on fa_kiosk_sessions;
create trigger trg_fa_kiosk_audit_session_checkin
  after insert on fa_kiosk_sessions
  for each row execute function fa_kiosk_audit_session_checkin_trg();

create or replace function fa_kiosk_audit_session_finish_trg() returns trigger as $$
declare
  v_employee_id uuid;
  v_action text;
begin
  if new.status is distinct from 'FINALIZADA' or old.status = 'FINALIZADA' then
    return new;
  end if;

  if new.checkout_at_ms is not null then
    v_action := 'SAIDA_CHECKOUT';
    select closed_by_employee_id into v_employee_id from fa_kiosk_orders where id = new.order_id;
  else
    v_action := 'SESSAO_CANCELADA';
    v_employee_id := fa_kiosk_current_employee_id();
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    v_employee_id,
    v_action,
    'INFO',
    jsonb_build_object(
      'sessionId', new.id,
      'unitId', new.unit_id,
      'childName', new.child_name_snapshot,
      'orderId', new.order_id
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_session_finish on fa_kiosk_sessions;
create trigger trg_fa_kiosk_audit_session_finish
  after update of status on fa_kiosk_sessions
  for each row execute function fa_kiosk_audit_session_finish_trg();

-- ---------------------------------------------------------------------------
-- Caixa (turnos, movimentos, envelopes)
-- ---------------------------------------------------------------------------
create or replace function fa_kiosk_audit_shift_open_trg() returns trigger as $$
begin
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.opened_by_employee_id,
    'CAIXA_TURNO_ABERTO',
    'INFO',
    jsonb_build_object('shiftId', new.id, 'unitId', new.unit_id, 'openingCashCents', new.opening_cash_cents)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_shift_open on fa_kiosk_shifts;
create trigger trg_fa_kiosk_audit_shift_open
  after insert on fa_kiosk_shifts
  for each row execute function fa_kiosk_audit_shift_open_trg();

create or replace function fa_kiosk_audit_shift_close_trg() returns trigger as $$
begin
  if new.status is distinct from 'FECHADO' or old.status = 'FECHADO' then
    return new;
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.closed_by_employee_id,
    'CAIXA_TURNO_FECHADO',
    'INFO',
    jsonb_build_object('shiftId', new.id, 'unitId', new.unit_id, 'declared', new.declared_json, 'expected', new.expected_json)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_shift_close on fa_kiosk_shifts;
create trigger trg_fa_kiosk_audit_shift_close
  after update of status on fa_kiosk_shifts
  for each row execute function fa_kiosk_audit_shift_close_trg();

create or replace function fa_kiosk_audit_cash_movement_trg() returns trigger as $$
begin
  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.employee_id,
    'CAIXA_' || new.kind,
    'INFO',
    jsonb_build_object(
      'movementId', new.id,
      'shiftId', new.shift_id,
      'amountCents', new.amount_cents,
      'reason', new.reason,
      'envelopeNumber', new.envelope_number
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_cash_movement on fa_kiosk_cash_movements;
create trigger trg_fa_kiosk_audit_cash_movement
  after insert on fa_kiosk_cash_movements
  for each row execute function fa_kiosk_audit_cash_movement_trg();

create or replace function fa_kiosk_audit_envelope_collect_trg() returns trigger as $$
begin
  if new.collected_at_ms is null or old.collected_at_ms is not null then
    return new;
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (
    new.collected_by_employee_id,
    'CAIXA_ENVELOPE_RECOLHIDO',
    'INFO',
    jsonb_build_object('movementId', new.id, 'shiftId', new.shift_id, 'amountCents', new.amount_cents, 'envelopeNumber', new.envelope_number)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_audit_envelope_collect on fa_kiosk_cash_movements;
create trigger trg_fa_kiosk_audit_envelope_collect
  after update of collected_at_ms on fa_kiosk_cash_movements
  for each row execute function fa_kiosk_audit_envelope_collect_trg();
