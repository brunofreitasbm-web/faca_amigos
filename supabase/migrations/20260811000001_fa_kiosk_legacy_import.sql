-- Migração de suporte para recepção e carga de dados do repositório controle-caixa
-- Módulo: FaçaAmigos

-- 1. Tabela de controle de importação/lotes legados
create table if not exists fa_kiosk_legacy_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'controle-caixa',
  file_name text,
  total_records integer not null default 0,
  processed_records integer not null default 0,
  status text not null check (status in ('EM_ANDAMENTO', 'CONCLUIDO', 'ERRO')) default 'EM_ANDAMENTO',
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  completed_at_ms bigint,
  log_output text
);

-- 2. Suporte a campos de migração legada nas tabelas principais
alter table fa_kiosk_guardians add column if not exists legacy_source text;
alter table fa_kiosk_guardians add column if not exists legacy_id text;
alter table fa_kiosk_guardians add column if not exists notes text;
alter table fa_kiosk_guardians add column if not exists birth_date date;

alter table fa_kiosk_children add column if not exists legacy_source text;
alter table fa_kiosk_children add column if not exists legacy_id text;
alter table fa_kiosk_children add column if not exists notes text;
alter table fa_kiosk_children add column if not exists health_notes text;

alter table fa_kiosk_sessions add column if not exists legacy_source text;
alter table fa_kiosk_sessions add column if not exists legacy_id text;
alter table fa_kiosk_sessions add column if not exists duration_minutes integer;
alter table fa_kiosk_sessions add column if not exists overtime_minutes integer;
alter table fa_kiosk_sessions add column if not exists operator_name_snapshot text;

alter table fa_kiosk_payments add column if not exists legacy_source text;
alter table fa_kiosk_payments add column if not exists legacy_id text;

-- Índices para busca por ID legado
create index if not exists idx_fa_kiosk_guardians_legacy on fa_kiosk_guardians (legacy_source, legacy_id) where legacy_id is not null;
create index if not exists idx_fa_kiosk_children_legacy on fa_kiosk_children (legacy_source, legacy_id) where legacy_id is not null;
create index if not exists idx_fa_kiosk_sessions_legacy on fa_kiosk_sessions (legacy_source, legacy_id) where legacy_id is not null;

-- 3. Função RPC de importação atômica idempotente (fa_kiosk_import_legacy_record)
create or replace function fa_kiosk_import_legacy_record(p_record jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_guardian_id uuid;
  v_child_id uuid;
  v_session_id uuid := null;
  v_order_id uuid := null;
  v_unit_id uuid;
  v_default_plan_id uuid;
  
  v_guardian_name text;
  v_guardian_phone text;
  v_guardian_cpf text;
  v_guardian_notes text;
  v_guardian_legacy_id text;
  
  v_child_name text;
  v_child_birth_date date;
  v_child_inclusive boolean;
  v_child_notes text;
  v_child_legacy_id text;
  
  v_session_date date;
  v_checkin_ms bigint;
  v_checkout_ms bigint;
  v_activity text;
  v_wristband text;
  v_ticket text;
  v_operator text;
  v_duration int;
  v_overtime int;
  v_legacy_session_id text;
  
  v_amount_cents int;
  v_payment_method text;
  v_legacy_payment_id text;
begin
  -- 1. Extração dos Dados do Responsável
  v_guardian_name      := coalesce(p_record->'guardian'->>'full_name', p_record->'guardian'->>'nome', 'Responsável Não Informado');
  v_guardian_phone     := p_record->'guardian'->>'phone_e164';
  v_guardian_cpf       := p_record->'guardian'->>'cpf';
  v_guardian_notes     := p_record->'guardian'->>'notes';
  v_guardian_legacy_id := p_record->'guardian'->>'legacy_id';

  if v_guardian_phone is null or v_guardian_phone = '' then
    v_guardian_phone := '+5500000000000';
  end if;

  -- Upsert Responsável: prioriza busca por CPF, depois por telefone
  if v_guardian_cpf is not null and v_guardian_cpf <> '' then
    select id into v_guardian_id from fa_kiosk_guardians where cpf = v_guardian_cpf limit 1;
  end if;

  if v_guardian_id is null and v_guardian_phone <> '+5500000000000' then
    select id into v_guardian_id from fa_kiosk_guardians where phone_e164 = v_guardian_phone limit 1;
  end if;

  if v_guardian_id is null then
    insert into fa_kiosk_guardians (full_name, phone_e164, cpf, notes, legacy_source, legacy_id)
    values (
      v_guardian_name,
      v_guardian_phone,
      nullif(v_guardian_cpf, ''),
      v_guardian_notes,
      'controle-caixa',
      v_guardian_legacy_id
    )
    returning id into v_guardian_id;
  else
    update fa_kiosk_guardians
    set full_name = coalesce(v_guardian_name, full_name),
        notes = coalesce(v_guardian_notes, notes),
        legacy_source = 'controle-caixa',
        legacy_id = coalesce(v_guardian_legacy_id, legacy_id)
    where id = v_guardian_id;
  end if;

  -- 2. Extração dos Dados da Criança
  v_child_name        := coalesce(p_record->'child'->>'full_name', p_record->'child'->>'nome', 'Criança');
  v_child_birth_date  := coalesce((p_record->'child'->>'birth_date')::date, '2020-01-01'::date);
  v_child_inclusive   := coalesce((p_record->'child'->>'inclusive_eligible')::boolean, false);
  v_child_notes       := p_record->'child'->>'notes';
  v_child_legacy_id   := p_record->'child'->>'legacy_id';

  -- Tenta localizar criança existente pelo responsável + nome
  select c.id into v_child_id
  from fa_kiosk_children c
  join fa_kiosk_child_guardians cg on cg.child_id = c.id
  where cg.guardian_id = v_guardian_id and lower(c.full_name) = lower(v_child_name)
  limit 1;

  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, notes, legacy_source, legacy_id)
    values (v_child_name, v_child_birth_date, v_child_inclusive, v_child_notes, 'controle-caixa', v_child_legacy_id)
    returning id into v_child_id;

    insert into fa_kiosk_child_guardians (child_id, guardian_id, is_authorized_pickup)
    values (v_child_id, v_guardian_id, true)
    on conflict do nothing;
  end if;

  -- 3. Inserção de Sessão Legada (se houver no payload)
  if p_record->'session' is not null and p_record->'session' <> 'null'::jsonb then
    v_activity          := coalesce(p_record->'session'->>'activity', 'PLAYGROUND');
    v_wristband         := coalesce(p_record->'session'->>'wristband_code', 'LEG-' || gen_random_uuid());
    v_ticket            := coalesce(p_record->'session'->>'ticket_code', 'TICK-' || gen_random_uuid());
    v_session_date      := coalesce((p_record->'session'->>'business_date')::date, current_date);
    v_checkin_ms        := coalesce((p_record->'session'->>'checkin_at_ms')::bigint, (extract(epoch from now()) * 1000)::bigint);
    v_checkout_ms       := (p_record->'session'->>'checkout_at_ms')::bigint;
    v_operator          := p_record->'session'->>'operator';
    v_duration          := (p_record->'session'->>'duration_minutes')::int;
    v_overtime          := (p_record->'session'->>'overtime_minutes')::int;
    v_legacy_session_id := p_record->'session'->>'legacy_id';

    -- Pega primeira unidade e plano disponíveis para vinculação referencial
    select id into v_unit_id from fa_kiosk_units limit 1;
    select id into v_default_plan_id from fa_kiosk_plans limit 1;

    if v_unit_id is not null and v_default_plan_id is not null then
      insert into fa_kiosk_sessions (
        unit_id, activity, plan_id, child_id, child_name_snapshot, guardian_id,
        wristband_code, ticket_code, checkin_at_ms, checkout_at_ms, status,
        business_date, legacy_source, legacy_id, duration_minutes, overtime_minutes, operator_name_snapshot
      ) values (
        v_unit_id, v_activity, v_default_plan_id, v_child_id, v_child_name, v_guardian_id,
        v_wristband, v_ticket, v_checkin_ms, v_checkout_ms, 'FINALIZADA',
        v_session_date, 'controle-caixa', v_legacy_session_id, v_duration, v_overtime, v_operator
      )
      returning id into v_session_id;

      -- Registrar log de visita append-only
      insert into fa_kiosk_visit_log (child_id, activity, at_ms)
      values (v_child_id, v_activity, v_checkin_ms);

      -- 4. Inserção de Pagamento Legado (se houver)
      if p_record->'payment' is not null and p_record->'payment' <> 'null'::jsonb then
        v_amount_cents       := coalesce((p_record->'payment'->>'amount_cents')::int, 0);
        v_payment_method     := coalesce(p_record->'payment'->>'method', 'DINHEIRO');
        v_legacy_payment_id  := p_record->'payment'->>'legacy_id';

        -- Criar pedido associado
        insert into fa_kiosk_orders (unit_id, kind, total_cents, status, business_date, created_at_ms)
        values (v_unit_id, 'SESSAO', v_amount_cents, 'PAGA', v_session_date, v_checkin_ms)
        returning id into v_order_id;

        -- Item do pedido
        insert into fa_kiosk_order_items (
          order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id
        ) values (
          v_order_id, 'SESSAO', 'SERVICO', 'Sessão Histórica Controle Caixa', 1, v_amount_cents, v_amount_cents, v_amount_cents, v_session_id
        );

        -- Registro do pagamento
        insert into fa_kiosk_payments (
          order_id, method, amount_cents, legacy_source, legacy_id, created_at_ms
        ) values (
          v_order_id, v_payment_method, v_amount_cents, 'controle-caixa', v_legacy_payment_id, v_checkin_ms
        );
      end if;

    end if;
  end if;

  return jsonb_build_object(
    'status', 'success',
    'guardian_id', v_guardian_id,
    'child_id', v_child_id,
    'session_id', v_session_id,
    'order_id', v_order_id
  );
exception when others then
  return jsonb_build_object(
    'status', 'error',
    'message', SQLERRM
  );
end;
$$;
