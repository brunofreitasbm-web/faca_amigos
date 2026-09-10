-- =====================================================================
-- Saldo pré-pago da criança — indicador de passivo em aberto (Passo 8 / 8)
-- =====================================================================
-- Saldo pré-pago é receita recebida, serviço não prestado — sem
-- validade, então esse passivo nunca "some sozinho" como venceria um
-- pacote normal. Sem um número visível, o ticket médio e a meta do dia
-- inflam na venda e ninguém enxerga a dívida de horas que fica em
-- aberto. Este indicador não é preso a período (from/to): é o retrato
-- de HOJE do que ainda está devendo, por isso é uma RPC própria, não
-- mais uma coluna nas RPCs de relatório já filtradas por data.
--
-- Valor estimado = fração do que foi cobrado proporcional ao que ainda
-- não foi usado (charged_cents × remaining/minutes_total) — não o preço
-- de tabela: um crédito vendido com cupom de 50% deve aparecer aqui
-- pela metade, não pelo preço cheio.
-- =====================================================================

create or replace function fa_kiosk_prepaid_credit_liability(p_unit_id uuid)
returns table (credits_count integer, remaining_minutes integer, estimated_value_cents integer)
as $$
  select count(*)::integer,
         coalesce(sum(c.remaining_minutes), 0)::integer,
         coalesce(sum(round(c.charged_cents::numeric * c.remaining_minutes / greatest(c.minutes_total, 1))), 0)::integer
    from fa_kiosk_child_time_credits c
   where c.unit_id = p_unit_id
     and c.cancelled_at_ms is null
     and c.remaining_minutes > 0
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_prepaid_credit_liability(uuid) from public;
grant execute on function fa_kiosk_prepaid_credit_liability(uuid) to authenticated, service_role;
