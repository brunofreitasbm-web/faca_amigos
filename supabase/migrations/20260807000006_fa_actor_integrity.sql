-- Integridade do ator: quem o sistema registra como autor de uma ação passa a
-- ser quem está autenticado, não quem o cliente diz que é.
--
-- O problema: fa_checkin, fa_checkout, fa_create_pdv_order, fa_open_shift,
-- fa_close_shift e fa_record_cash_movement recebem `p_employee_id` no corpo da
-- chamada e gravam esse valor como autor. Mesmo com login funcionando, o
-- operador A registra venda, sangria e fechamento de caixa em nome do operador
-- B — o que corrompe exatamente o dado que tem valor probatório numa apuração
-- interna. (fa_register_ponto já foi corrigida assim na migration 25.)
--
-- Por que TRIGGER e não reescrever as funções: fa_checkout foi redefinida em
-- cinco migrations diferentes (11, 21, 22, 29, 34) e fa_create_pdv_order em
-- três. Recriar esses corpos de novo aqui multiplicaria as versões e o risco de
-- divergência. O trigger age sobre a TABELA — vale para todas as versões atuais
-- das funções e para as que vierem depois, sem tocar em nenhuma delas.
--
-- Regra: se há colaborador autenticado, o valor dele SUBSTITUI o que veio no
-- parâmetro. Se não há (service_role do print bridge e do worker fiscal,
-- scripts de seed rodando como postgres), o valor passado é mantido — senão
-- essas rotinas legítimas quebrariam.

create or replace function fa_kiosk_force_actor() returns trigger as $$
declare
  v_actor uuid := fa_kiosk_current_employee_id();
begin
  if v_actor is null then
    return new;  -- service_role / seed: nada a forçar
  end if;

  case tg_table_name
    when 'fa_kiosk_sessions' then
      if tg_op = 'INSERT' then new.checkin_by_employee_id := v_actor; end if;
    when 'fa_kiosk_session_events' then
      new.employee_id := v_actor;
    when 'fa_kiosk_cash_movements' then
      new.employee_id := v_actor;
    when 'fa_kiosk_shifts' then
      if tg_op = 'INSERT' then
        new.opened_by_employee_id := v_actor;
      elsif new.closed_by_employee_id is distinct from old.closed_by_employee_id then
        new.closed_by_employee_id := v_actor;
      end if;
    when 'fa_kiosk_orders' then
      -- `old` só existe em UPDATE; referenciá-lo num INSERT levanta erro em
      -- plpgsql, por isso o tg_op vem antes na condição.
      if tg_op = 'INSERT' then
        if new.closed_by_employee_id is not null then new.closed_by_employee_id := v_actor; end if;
      elsif new.closed_by_employee_id is distinct from old.closed_by_employee_id then
        new.closed_by_employee_id := v_actor;
      end if;
    else
      null;
  end case;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_force_actor() from public, anon, authenticated;

drop trigger if exists fa_kiosk_force_actor_trg on fa_kiosk_sessions;
create trigger fa_kiosk_force_actor_trg before insert on fa_kiosk_sessions
  for each row execute function fa_kiosk_force_actor();

drop trigger if exists fa_kiosk_force_actor_trg on fa_kiosk_session_events;
create trigger fa_kiosk_force_actor_trg before insert on fa_kiosk_session_events
  for each row execute function fa_kiosk_force_actor();

drop trigger if exists fa_kiosk_force_actor_trg on fa_kiosk_cash_movements;
create trigger fa_kiosk_force_actor_trg before insert on fa_kiosk_cash_movements
  for each row execute function fa_kiosk_force_actor();

drop trigger if exists fa_kiosk_force_actor_trg on fa_kiosk_shifts;
create trigger fa_kiosk_force_actor_trg before insert or update on fa_kiosk_shifts
  for each row execute function fa_kiosk_force_actor();

drop trigger if exists fa_kiosk_force_actor_trg on fa_kiosk_orders;
create trigger fa_kiosk_force_actor_trg before insert or update on fa_kiosk_orders
  for each row execute function fa_kiosk_force_actor();

-- ---------------------------------------------------------------------------
-- Capacidades das exceções operacionais (nível Líder)
-- ---------------------------------------------------------------------------
-- Sangria e suprimento tiram e põem dinheiro no caixa fora de uma venda: é a
-- operação em que a diferença entre "Operador" e "Líder" tem consequência
-- financeira direta. Como as RPCs correspondentes não checam nada, a validação
-- vai aqui — no mesmo lugar que o cliente não alcança.
--
-- TROCO_INICIAL fica de fora: é parte de abrir o caixa, que o Operador faz.
create or replace function fa_kiosk_guard_cash_movement() returns trigger as $$
begin
  if fa_kiosk_current_employee_id() is null then
    return new;  -- service_role / seed
  end if;
  if new.kind in ('SANGRIA', 'SUPRIMENTO', 'AJUSTE') and not fa_kiosk_can('caixa.sangria') then
    raise exception 'apenas um líder ou o proprietário pode registrar sangria, suprimento ou ajuste'
      using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_guard_cash_movement() from public, anon, authenticated;

drop trigger if exists fa_kiosk_guard_cash_movement_trg on fa_kiosk_cash_movements;
create trigger fa_kiosk_guard_cash_movement_trg before insert on fa_kiosk_cash_movements
  for each row execute function fa_kiosk_guard_cash_movement();

-- Troca de plano com sessão em andamento (fa_kiosk_change_session_plan) e pausa
-- de sessão são exceções de atendimento, não operação de rotina: exigem Líder.
create or replace function fa_kiosk_guard_session_exception() returns trigger as $$
begin
  if fa_kiosk_current_employee_id() is null then
    return new;
  end if;
  -- Só o que muda o plano já vendido ou cancela a sessão. Check-in, checkout e
  -- os eventos normais de atendimento continuam liberados ao Operador.
  if new.plan_id is distinct from old.plan_id and not fa_kiosk_can('sessao.change_plan') then
    raise exception 'apenas um líder ou o proprietário pode trocar o plano de uma sessão em andamento'
      using errcode = '42501';
  end if;
  if new.status = 'FINALIZADA' and old.status = 'ATIVA'
     and new.checkout_at_ms is null and not fa_kiosk_can('sessao.cancel') then
    raise exception 'apenas um líder ou o proprietário pode cancelar uma sessão sem checkout'
      using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_guard_session_exception() from public, anon, authenticated;

drop trigger if exists fa_kiosk_guard_session_exception_trg on fa_kiosk_sessions;
create trigger fa_kiosk_guard_session_exception_trg before update on fa_kiosk_sessions
  for each row execute function fa_kiosk_guard_session_exception();

-- Estorno/cancelamento de venda já paga também é exceção de Líder.
create or replace function fa_kiosk_guard_order_cancel() returns trigger as $$
begin
  if fa_kiosk_current_employee_id() is null then
    return new;
  end if;
  if new.status = 'CANCELADA' and old.status <> 'CANCELADA' and not fa_kiosk_can('venda.estorno') then
    raise exception 'apenas um líder ou o proprietário pode cancelar ou estornar uma venda'
      using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_guard_order_cancel() from public, anon, authenticated;

drop trigger if exists fa_kiosk_guard_order_cancel_trg on fa_kiosk_orders;
create trigger fa_kiosk_guard_order_cancel_trg before update on fa_kiosk_orders
  for each row execute function fa_kiosk_guard_order_cancel();
