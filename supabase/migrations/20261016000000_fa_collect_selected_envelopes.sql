-- Saldo em Envelopes: o gestor passa a escolher QUAIS envelopes leva da loja
-- (antes era tudo-ou-nada por loja, fa_collect_envelopes). A tela lista cada
-- envelope pendente e recolhe só os selecionados. fa_collect_envelopes segue
-- existindo (retrocompat); a auditoria por envelope já é feita pelo trigger
-- trg_fa_kiosk_audit_envelope_collect (CAIXA_ENVELOPE_RECOLHIDO).

-- Um envelope por linha, só os pendentes (ainda na loja). Mesmo critério de
-- envelope do saldo: SANGRIA com envelope_number.
create or replace function fa_pending_envelopes()
returns table (
  movement_id uuid,
  unit_id uuid,
  envelope_number text,
  amount_cents bigint,
  at_ms bigint,
  reason text,
  employee_id uuid
) as $$
  select m.id, s.unit_id, m.envelope_number, m.amount_cents::bigint, m.at_ms, m.reason, m.employee_id
  from fa_kiosk_cash_movements m
  join fa_kiosk_shifts s on s.id = m.shift_id
  where m.kind = 'SANGRIA'
    and m.envelope_number is not null
    and m.collected_at_ms is null
  order by s.unit_id, m.at_ms;
$$ language sql stable security definer set search_path = public, pg_temp;

-- Recolhe apenas os envelopes informados, e só se forem da unidade indicada e
-- ainda pendentes. requested_count permite à tela detectar divergência (outro
-- gestor já recolheu, id de outra loja).
create or replace function fa_collect_selected_envelopes(
  p_idempotency_key text,
  p_unit_id uuid,
  p_employee_id uuid,
  p_movement_ids uuid[]
) returns jsonb as $$
declare
  v_cached jsonb;
  v_requested int;
  v_count bigint;
  v_total bigint;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select count(distinct x) into v_requested from unnest(coalesce(p_movement_ids, '{}'::uuid[])) x;
  if v_requested = 0 then
    raise exception 'Nenhum envelope selecionado para recolhimento.';
  end if;

  with upd as (
    update fa_kiosk_cash_movements m
    set collected_at_ms = (extract(epoch from now()) * 1000)::bigint,
        collected_by_employee_id = p_employee_id
    from fa_kiosk_shifts s
    where s.id = m.shift_id
      and s.unit_id = p_unit_id
      and m.id = any(p_movement_ids)
      and m.kind = 'SANGRIA'
      and m.envelope_number is not null
      and m.collected_at_ms is null
    returning m.amount_cents
  )
  select count(*), coalesce(sum(amount_cents), 0) into v_count, v_total from upd;

  v_cached := jsonb_build_object(
    'ok', true,
    'requested_count', v_requested,
    'collected_count', v_count,
    'collected_cents', v_total
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_collect_selected_envelopes', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pending_envelopes() from public, anon;
grant execute on function fa_pending_envelopes() to authenticated;
revoke execute on function fa_collect_selected_envelopes(text, uuid, uuid, uuid[]) from public, anon;
grant execute on function fa_collect_selected_envelopes(text, uuid, uuid, uuid[]) to authenticated;
