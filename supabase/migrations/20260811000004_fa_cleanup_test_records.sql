-- Limpeza de registros de caixa e faturamento de teste (01/08/2026 até o momento)
-- Preserva os cadastros de clientes (guardians/children) e as 1.604 vendas importadas do sales.csv (legacy_source = 'controle-caixa')

-- 1. Consolidar e excluir a descrição antiga 'Faça Amigos Playground' mantendo a unidade oficial 'Faça Amigos Playground (Parque Shopping)'
do $$
declare
  v_old_id uuid;
  v_target_id uuid := '11111111-1111-1111-1111-111111111111';
begin
  select id into v_old_id from fa_kiosk_units where name = 'Faça Amigos Playground' and id <> v_target_id limit 1;

  if v_old_id is not null then
    update fa_kiosk_sessions set unit_id = v_target_id where unit_id = v_old_id;
    update fa_kiosk_plans set unit_id = v_target_id where unit_id = v_old_id;
    update fa_kiosk_orders set unit_id = v_target_id where unit_id = v_old_id;
    update fa_kiosk_assets set unit_id = v_target_id where unit_id = v_old_id;
    delete from fa_kiosk_units where id = v_old_id;
  end if;
end $$;

-- 2. Garantir que a unidade padrão tenha o nome oficial 'Faça Amigos Playground (Parque Shopping)'
update fa_kiosk_units
set name = 'Faça Amigos Playground (Parque Shopping)'
where id = '11111111-1111-1111-1111-111111111111' or name = 'Faça Amigos Playground';

-- 3. Desvincular shift_id de pedidos
update fa_kiosk_orders set shift_id = null where shift_id is not null;

-- 4. Limpar movimentações manuais de caixa de teste (sangrias / suprimentos)
delete from fa_kiosk_cash_movements;

-- 5. Limpar pagamentos de teste do app Kiosk
delete from fa_kiosk_payments
where (legacy_source is null or legacy_source <> 'controle-caixa');

-- 6. Limpar itens de pedidos de teste do app Kiosk
delete from fa_kiosk_order_items
where order_id not in (
  select order_id from fa_kiosk_payments where legacy_source = 'controle-caixa'
);

-- 7. Limpar pedidos de teste do app Kiosk
delete from fa_kiosk_orders
where id not in (
  select order_id from fa_kiosk_payments where legacy_source = 'controle-caixa'
);

-- 8. Limpar envelopes fiscais de teste se a tabela existir
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'fa_kiosk_fiscal_envelopes') then
    execute 'delete from fa_kiosk_fiscal_envelopes';
  end if;
end $$;

-- 9. Limpar todos os turnos de caixa de teste
delete from fa_kiosk_shifts;

-- 10. Limpar eventos, push subscriptions e banco de horas de sessões de teste do app Kiosk
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'fa_kiosk_push_subscriptions') then
    execute 'delete from fa_kiosk_push_subscriptions where session_id in (select id from fa_kiosk_sessions where legacy_source is null or legacy_source <> ''controle-caixa'')';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'fa_kiosk_hour_bank_credits') then
    execute 'delete from fa_kiosk_hour_bank_credits where source_session_id in (select id from fa_kiosk_sessions where legacy_source is null or legacy_source <> ''controle-caixa'')';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'fa_kiosk_hour_bank_debits') then
    execute 'delete from fa_kiosk_hour_bank_debits where session_id in (select id from fa_kiosk_sessions where legacy_source is null or legacy_source <> ''controle-caixa'')';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'fa_kiosk_session_events') then
    execute 'delete from fa_kiosk_session_events where session_id in (select id from fa_kiosk_sessions where legacy_source is null or legacy_source <> ''controle-caixa'')';
  end if;
end $$;

-- 11. Limpar sessões de teste do app Kiosk (preservando o histórico do sales.csv)
delete from fa_kiosk_sessions
where (legacy_source is null or legacy_source <> 'controle-caixa');
