-- Fechamento de turno: o "esperado" em DINHEIRO passa a ser SÓ as vendas em
-- espécie do turno. Regra de negócio confirmada pelo owner em 2026-09-01:
-- no fechamento o operador declara o que VENDEU no dia por forma de
-- pagamento, não o que está na gaveta. O fundo de caixa (TROCO_INICIAL)
-- fica na gaveta de um turno para o outro e é conferido na abertura do
-- turno seguinte — por isso TROCO_INICIAL, SUPRIMENTO, SANGRIA e AJUSTE
-- deixam de entrar na conta do esperado.
--
-- Caso real que motivou: Circuito 01/09 — vendas em dinheiro R$ 150,
-- fundo R$ 120, sangria R$ 150 (envelope 01). Operador declarou R$ 150
-- (correto pela regra) e o sistema apontou sobra de R$ 30 porque
-- esperava R$ 120 (conteúdo da gaveta).
--
-- fa_units_cash_status (aba "Saldo em Caixa") continua somando
-- fundo + suprimentos − sangrias: lá a pergunta é "quanto há fisicamente na
-- gaveta agora", que é outra coisa.

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

  -- DINHEIRO sempre presente no esperado (0 se não houve venda em espécie),
  -- para a divergência ser calculada mesmo quando o operador declara algo.
  if not (v_expected ? 'DINHEIRO') then
    v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(0));
  end if;

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
