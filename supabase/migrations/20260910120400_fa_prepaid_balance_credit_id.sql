-- =====================================================================
-- Saldo pré-pago da criança — id do crédito mais antigo no saldo (Passo 6 / 8)
-- =====================================================================
-- fa_checkin recebe um `p_child_credit_id` específico (não um flag como
-- p_use_hour_bank) porque a fila do Painel opera linha a linha — cada
-- crédito pode ter uma tarifa de excedente diferente, e o operador
-- escolhe exatamente qual. O card de busca da Entrada, porém, mostra
-- só o SALDO AGREGADO da criança (soma de todos os créditos válidos) —
-- por isso fa_kiosk_child_credit_balance passa a devolver também o id
-- do crédito mais antigo (FIFO, mesmo critério de débito do
-- fa_kiosk_child_credit_consume): é o que o card usa para representar
-- "o" crédito da criança. O débito de verdade, no fechamento, continua
-- consumindo o saldo inteiro da criança em ordem de compra,
-- independente de qual credit_id foi referenciado no check-in — o id
-- só decide a tarifa/piso congelados na sessão, não limita de qual
-- linha o dinheiro sai.
-- =====================================================================

drop function if exists fa_kiosk_child_credit_balance(uuid[]);

create or replace function fa_kiosk_child_credit_balance(p_child_ids uuid[])
returns table (child_id uuid, remaining_minutes integer, credits_count integer, credit_id uuid)
as $$
  select c.child_id, sum(c.remaining_minutes)::integer, count(*)::integer,
         (array_agg(c.id order by c.purchased_at_ms asc))[1]
    from fa_kiosk_child_time_credits c
   where c.child_id = any(coalesce(p_child_ids, array[]::uuid[]))
     and c.cancelled_at_ms is null
     and c.remaining_minutes > 0
   group by c.child_id
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_child_credit_balance(uuid[]) from public;
grant execute on function fa_kiosk_child_credit_balance(uuid[]) to authenticated, service_role;
