-- Duas colunas novas a pedido do dono:
-- 1) fundo_caixa_cents em fa_kiosk_cash_movements — quanto fica na gaveta
--    depois de uma sangria de envelope (a UI torna obrigatório só para o
--    fluxo "Registrar Envelope"; outras kinds/telas seguem sem preencher).
-- 2) close_justificativas_json em fa_kiosk_shifts — texto do operador
--    explicando cada divergência declarado x esperado no fechamento de
--    turno. Não participa do cálculo de v_expected/v_divergence em
--    fa_close_shift (que continua 100% servidor, "às cegas") — é só
--    anotação sobre um número que o servidor já calculou sozinho.

alter table fa_kiosk_cash_movements add column if not exists fundo_caixa_cents integer;
alter table fa_kiosk_shifts add column if not exists close_justifications_json jsonb;

-- create or replace com parâmetro novo no final (default) cria uma
-- assinatura de função nova para o Postgres — precisa reemitir os grants
-- que 20260810000003/20260810000004 aplicaram à assinatura de 8 parâmetros.
create or replace function fa_record_cash_movement(
  p_idempotency_key text,
  p_shift_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_reason text,
  p_employee_id uuid,
  p_envelope_number text default null,
  p_photo_url text default null,
  p_fundo_caixa_cents integer default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, reason, employee_id, at_ms, envelope_number, photo_url, fundo_caixa_cents)
    values (p_shift_id, p_kind, p_amount_cents, p_reason, p_employee_id, (extract(epoch from now()) * 1000)::bigint, p_envelope_number, p_photo_url, p_fundo_caixa_cents);

  v_cached := jsonb_build_object('ok', true);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_record_cash_movement', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

revoke execute on function fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text, integer) from public, anon;
grant execute on function fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text, integer) to authenticated;

-- A assinatura antiga de 8 parâmetros fica órfã (create or replace não a
-- substitui, só cria uma nova) — remove pra não deixar uma via de chamada
-- sem os grants corretos.
drop function if exists fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text);

-- Achado ao verificar assinaturas: a versão original de 6 parâmetros
-- (antes de envelope_number/photo_url) nunca foi removida quando
-- 20260808070000 criou a de 8 — ficou órfã desde então (sem grant a
-- anon/public, mas também sem chamador; client sempre manda 8/9
-- argumentos). Remove agora, já que estamos mexendo nesta função.
drop function if exists fa_record_cash_movement(text, uuid, text, integer, text, uuid);

create or replace function fa_close_shift(
  p_idempotency_key text,
  p_shift_id uuid,
  p_employee_id uuid,
  p_declared jsonb, -- {"DINHEIRO": 12345, "PIX": 6789, ...}
  p_justifications jsonb default '{}'::jsonb -- {"DINHEIRO": "texto da justificativa", ...}
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
  v_expected jsonb := '{}'::jsonb;
  v_divergence jsonb := '{}'::jsonb;
  v_cash_adjustments integer := 0;
  v_row record;
  v_method text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id for update;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  for v_row in
    select p.method, sum(p.amount_cents) as total_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id
    group by p.method
  loop
    v_expected := jsonb_set(v_expected, array[v_row.method], to_jsonb(v_row.total_cents));
  end loop;

  select coalesce(sum(case
      when kind in ('SUPRIMENTO', 'TROCO_INICIAL') then amount_cents
      when kind = 'SANGRIA' then -amount_cents
      else amount_cents -- AJUSTE pode ser positivo ou negativo
    end), 0) into v_cash_adjustments
  from fa_kiosk_cash_movements where shift_id = p_shift_id;

  v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(coalesce((v_expected->>'DINHEIRO')::integer, 0) + v_cash_adjustments));

  update fa_kiosk_shifts set status = 'FECHADO', closed_by_employee_id = p_employee_id,
    closed_at_ms = (extract(epoch from now()) * 1000)::bigint, declared_json = p_declared, expected_json = v_expected,
    close_justifications_json = p_justifications
    where id = p_shift_id;

  for v_method in select distinct key from (
    select jsonb_object_keys(v_expected) as key union select jsonb_object_keys(p_declared) as key
  ) k loop
    v_divergence := jsonb_set(v_divergence, array[v_method],
      to_jsonb(coalesce((p_declared->>v_method)::integer, 0) - coalesce((v_expected->>v_method)::integer, 0)));
  end loop;

  v_cached := jsonb_build_object('expected', v_expected, 'declared', p_declared, 'divergence', v_divergence, 'justifications', p_justifications);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_close_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

drop function if exists fa_close_shift(text, uuid, uuid, jsonb);
