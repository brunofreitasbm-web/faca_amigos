-- =====================================================================
-- "Mudar Plano" (Painel) passa a aceitar Pacote como opção — FaçaAmigos
-- =====================================================================
-- Pedido: a listbox de "Mudar Plano" no Painel (troca de plano de uma
-- sessão já em andamento) deve oferecer os Pacotes cadastrados junto com
-- os Planos, igual já acontece na Entrada (20260816000003_fa_checkin_pacotes.sql).
--
-- fa_kiosk_change_session_plan ganha um p_package_id opcional. Quando
-- informado, espelha o que fa_checkin já faz ao entrar direto por um
-- Pacote: cria o saldo do responsável em fa_kiosk_guardian_packages (preço
-- cheio, sem desconto de cupom — não há cupom numa troca de plano) e
-- grava o trio de colunas snapshot em fa_kiosk_sessions, zerando plan_id.
-- Quando p_package_id é nulo, volta a ser uma troca de Plano normal e
-- limpa qualquer pacote que a sessão estivesse usando.
--
-- DROP obrigatório: novo parâmetro muda a assinatura da função.
-- =====================================================================

drop function if exists fa_kiosk_change_session_plan(uuid, uuid);

create or replace function fa_kiosk_change_session_plan(
  p_session_id uuid,
  p_plan_id uuid,
  p_package_id uuid default null
) returns void as $$
declare
  v_session record;
  v_pkg record;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_session from fa_kiosk_sessions where id = p_session_id and status = 'ATIVA';
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;

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
