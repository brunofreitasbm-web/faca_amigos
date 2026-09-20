-- =====================================================================
-- Passagem de Turno — livro de registro diário entre operadores
-- =====================================================================
-- Por que isto existe: os operadores não se cruzam fisicamente. Quem
-- fecha à noite vai embora antes de quem abre no dia seguinte chegar.
-- Até aqui não havia nenhum canal formal entre os dois — alteração de
-- brinquedo, aviso de festa marcada, regra nova do shopping: tudo se
-- perdia ou virava mensagem solta de WhatsApp.
--
-- Regra de negócio (owner, 2026-09-20):
--   FECHAMENTO  Preenchimento OBRIGATÓRIO. Ou o operador escreve o que
--               precisa ser repassado, ou declara explicitamente "sem
--               alteração". Nunca as duas coisas, nunca nenhuma.
--   ABERTURA    Quem abre o turno no dia seguinte é obrigado a LER e dar
--               ciência antes de operar, logo depois de abrir o caixa.
--
-- A obrigatoriedade mora AQUI, dentro de fa_close_shift, e não só na
-- tela. Motivo: o fechamento pode ir para a fila offline do quiosque
-- (callResilient). Se a passagem fosse uma RPC separada, o par
-- "salvar passagem" + "fechar turno" deixaria de ser atômico — uma iria
-- para a fila, a outra falharia a regra, e o turno ficaria aberto com a
-- passagem já gravada. Uma chamada só = uma chave de idempotência, uma
-- transação.

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_shift_handovers (
  id uuid primary key default gen_random_uuid(),
  -- unique: é o que torna o replay da fila offline seguro. Um fechamento
  -- reenviado não pode gerar duas passagens para o mesmo turno.
  shift_id uuid not null unique references fa_kiosk_shifts(id),
  unit_id uuid not null references fa_kiosk_units(id),
  business_date date not null,
  closed_by_employee_id uuid references fa_kiosk_employees(id),
  no_changes boolean not null default false,
  conteudo text,
  created_at_ms bigint not null
);

create index if not exists fa_kiosk_shift_handovers_unit_idx
  on fa_kiosk_shift_handovers (unit_id, created_at_ms desc);

create table if not exists fa_kiosk_shift_handover_acks (
  handover_id uuid not null references fa_kiosk_shift_handovers(id),
  employee_id uuid not null references fa_kiosk_employees(id),
  acked_at_ms bigint not null,
  acked_in_shift_id uuid references fa_kiosk_shifts(id),
  -- Tempo entre abrir o modal de leitura e confirmar a ciência. É a única
  -- evidência auditável de que houve leitura de fato: 2 segundos entre
  -- abrir e confirmar aparece no Gerencial e denuncia o clique automático.
  leitura_ms integer,
  primary key (handover_id, employee_id)
);

-- ---------------------------------------------------------------------
-- 2. Derruba as assinaturas antigas de fa_close_shift ANTES do create.
--
-- Postgres trata 7 e 9 argumentos como funções DIFERENTES, e o PostgREST
-- resolve a chamada pelos nomes dos argumentos que recebe. Sem este drop,
-- a versão de 7 parâmetros continuaria viva e um bundle antigo em cache
-- seguiria fechando turno sem passagem — em silêncio, para sempre.
-- Auditado antes de dropar: nenhuma trigger, view ou outra RPC chama
-- fa_close_shift; os únicos chamadores são apps/kiosk-ui/src/api/client.ts
-- e esta migration.
-- ---------------------------------------------------------------------
drop function if exists fa_close_shift(text, uuid, uuid, jsonb, jsonb, integer, integer);
drop function if exists fa_close_shift(text, uuid, uuid, jsonb, jsonb);
drop function if exists fa_close_shift(text, uuid, uuid, jsonb);

-- ---------------------------------------------------------------------
-- 3. Fechamento — corpo idêntico ao de 20260902000001, acrescido da
--    validação e da gravação da passagem de turno.
--
--    Os parâmetros novos NÃO têm default permissivo por acidente: o
--    default null cai direto no ramo PASSAGEM_TURNO_OBRIGATORIA. Um
--    cliente antigo (ou uma chamada que ficou na fila offline antes do
--    deploy) é recusado de propósito — fechar sem passagem é exatamente
--    o que esta migration existe para impedir.
-- ---------------------------------------------------------------------
create or replace function fa_close_shift(
  p_idempotency_key text,
  p_shift_id uuid,
  p_employee_id uuid,
  p_declared jsonb, -- {"DINHEIRO": 12345, "PIX": 6789, ...}
  p_justifications jsonb default '{}'::jsonb, -- {"DINHEIRO": "...", "GAVETA": "..."}
  p_counted_cash_cents integer default null,   -- Dinheiro_Total_Gaveta (contado)
  p_next_day_float_cents integer default null, -- Fundo_Caixa_Proximo_Dia
  p_handover_no_changes boolean default null,  -- "sem alteração a registrar"
  p_handover_conteudo text default null        -- texto livre da passagem
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
  v_expected jsonb := '{}'::jsonb;
  v_divergence jsonb := '{}'::jsonb;
  v_row record;
  v_method text;
  v_cash_sales integer := 0;
  v_drawer_final integer := 0;
  v_drawer_expected integer;
  v_envelope integer;
  v_cash_break integer;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_texto text;
  v_sem_alteracao boolean := coalesce(p_handover_no_changes, false);
  v_shift record;
  v_handover_id uuid;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_shift from fa_kiosk_shifts where id = p_shift_id for update;
  v_status := v_shift.status;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  -- Passagem de turno: validar ANTES de qualquer efeito colateral, para o
  -- turno continuar ABERTO quando a regra falha.
  v_texto := btrim(coalesce(p_handover_conteudo, ''));
  if not v_sem_alteracao and length(v_texto) < 10 then
    raise exception 'PASSAGEM_TURNO_OBRIGATORIA';
  end if;
  if v_sem_alteracao and length(v_texto) > 0 then
    -- Marcar "sem alteração" e escrever ao mesmo tempo torna o registro
    -- ambíguo para quem lê amanhã. Recusa em vez de escolher por ele.
    raise exception 'PASSAGEM_TURNO_CONTRADITORIA';
  end if;

  for v_row in
    select p.method, sum(p.amount_cents) as total_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id
    group by p.method
  loop
    v_expected := jsonb_set(v_expected, array[v_row.method], to_jsonb(v_row.total_cents));
  end loop;

  -- DINHEIRO sempre presente no esperado (0 se não houve venda em espécie).
  if not (v_expected ? 'DINHEIRO') then
    v_expected := jsonb_set(v_expected, array['DINHEIRO'], to_jsonb(0));
  end if;
  v_cash_sales := coalesce((v_expected->>'DINHEIRO')::integer, 0);

  -- Conferência física da gaveta (só quando o cliente mandou a contagem).
  if p_counted_cash_cents is not null then
    if p_counted_cash_cents < 0 then
      raise exception 'DINHEIRO_CONTADO_INVALIDO';
    end if;
    if p_next_day_float_cents is null or p_next_day_float_cents < 0 then
      raise exception 'FUNDO_PROXIMO_DIA_INVALIDO';
    end if;
    if p_next_day_float_cents > p_counted_cash_cents then
      raise exception 'FUNDO_PROXIMO_DIA_MAIOR_QUE_CONTADO';
    end if;

    v_envelope := p_counted_cash_cents - p_next_day_float_cents;

    -- O envelope é a prova física da retirada: precisa existir como SANGRIA
    -- com número de envelope e o mesmo valor calculado aqui.
    if v_envelope > 0 and not exists (
      select 1 from fa_kiosk_cash_movements
      where shift_id = p_shift_id and kind = 'SANGRIA'
        and envelope_number is not null and amount_cents = v_envelope
    ) then
      raise exception 'ENVELOPE_NAO_REGISTRADO: registre o envelope de % centavos antes de fechar', v_envelope;
    end if;

    -- O que deveria estar na gaveta AGORA (depois do envelope sair):
    -- fundo inicial (TROCO_INICIAL) + vendas em dinheiro + suprimentos/
    -- ajustes − sangrias (avulsas e envelopes). Mesma conta de
    -- fa_units_cash_status.
    select coalesce(sum(case
        when kind in ('SUPRIMENTO', 'TROCO_INICIAL') then amount_cents
        when kind = 'SANGRIA' then -amount_cents
        else amount_cents
      end), 0) into v_drawer_final
    from fa_kiosk_cash_movements where shift_id = p_shift_id;
    v_drawer_final := v_drawer_final + v_cash_sales;

    -- Esperado no momento da contagem = gaveta final + envelope que saiu.
    v_drawer_expected := v_drawer_final + v_envelope;
    v_cash_break := p_counted_cash_cents - v_drawer_expected;
  end if;

  update fa_kiosk_shifts set status = 'FECHADO', closed_by_employee_id = p_employee_id,
    closed_at_ms = v_now_ms, declared_json = p_declared, expected_json = v_expected,
    close_justifications_json = p_justifications,
    counted_cash_cents = p_counted_cash_cents,
    drawer_expected_cents = v_drawer_expected,
    cash_break_cents = v_cash_break,
    next_day_float_cents = p_next_day_float_cents,
    envelope_cents = v_envelope
    where id = p_shift_id;

  insert into fa_kiosk_shift_handovers
      (shift_id, unit_id, business_date, closed_by_employee_id, no_changes, conteudo, created_at_ms)
    values (p_shift_id, v_shift.unit_id, v_shift.business_date, p_employee_id,
            v_sem_alteracao, nullif(v_texto, ''), v_now_ms)
    on conflict (shift_id) do nothing
    returning id into v_handover_id;

  for v_method in select distinct key from (
    select jsonb_object_keys(v_expected) as key union select jsonb_object_keys(p_declared) as key
  ) k loop
    v_divergence := jsonb_set(v_divergence, array[v_method],
      to_jsonb(coalesce((p_declared->>v_method)::integer, 0) - coalesce((v_expected->>v_method)::integer, 0)));
  end loop;

  v_cached := jsonb_build_object(
    'expected', v_expected, 'declared', p_declared, 'divergence', v_divergence, 'justifications', p_justifications,
    'countedCashCents', p_counted_cash_cents,
    'drawerExpectedCents', v_drawer_expected,
    'cashBreakCents', v_cash_break,
    'nextDayFloatCents', p_next_day_float_cents,
    'envelopeCents', v_envelope,
    'handover', jsonb_build_object(
      'id', v_handover_id,
      'noChanges', v_sem_alteracao,
      'conteudo', nullif(v_texto, '')
    )
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_close_shift', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Assinatura nova → grants precisam ser reemitidos (mesmo padrão de
-- 20260902000001).
revoke execute on function fa_close_shift(text, uuid, uuid, jsonb, jsonb, integer, integer, boolean, text) from public, anon;
grant execute on function fa_close_shift(text, uuid, uuid, jsonb, jsonb, integer, integer, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Passagens pendentes de leitura para um funcionário, numa unidade.
--
-- Não é "só a última": quem ficou de folga dois dias precisa ver os avisos
-- do intervalo — é exatamente para isso que o livro existe. A cláusula
-- "mais nova que a última já lida" deixa o conjunto naturalmente vazio no
-- regime normal, e o recorte de 7 dias evita uma parede de telas depois
-- de férias (o histórico completo fica na aba Gerencial).
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_pending_handovers(
  p_unit_id uuid,
  p_employee_id uuid
) returns table (
  id uuid,
  business_date date,
  created_at_ms bigint,
  no_changes boolean,
  conteudo text,
  closed_by_name text
) as $$
declare
  v_last_acked bigint;
  v_cutoff_ms bigint := (extract(epoch from now()) * 1000)::bigint - (7 * 24 * 60 * 60 * 1000);
begin
  select max(h.created_at_ms) into v_last_acked
  from fa_kiosk_shift_handover_acks a
  join fa_kiosk_shift_handovers h on h.id = a.handover_id
  where a.employee_id = p_employee_id and h.unit_id = p_unit_id;

  return query
  select h.id, h.business_date, h.created_at_ms, h.no_changes, h.conteudo,
         e.full_name
  from fa_kiosk_shift_handovers h
  left join fa_kiosk_employees e on e.id = h.closed_by_employee_id
  where h.unit_id = p_unit_id
    and h.created_at_ms > coalesce(v_last_acked, 0)
    and h.created_at_ms >= v_cutoff_ms
    -- Quem escreveu a passagem não precisa ler a própria passagem.
    and (h.closed_by_employee_id is null or h.closed_by_employee_id <> p_employee_id)
    and not exists (
      select 1 from fa_kiosk_shift_handover_acks a
      where a.handover_id = h.id and a.employee_id = p_employee_id
    )
  order by h.created_at_ms asc
  limit 10;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_pending_handovers(uuid, uuid) from public, anon;
grant execute on function fa_kiosk_pending_handovers(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Ciência de leitura
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_ack_handover(
  p_idempotency_key text,
  p_handover_id uuid,
  p_employee_id uuid,
  p_shift_id uuid default null,
  p_leitura_ms integer default null
) returns jsonb as $$
declare
  v_cached jsonb;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if not exists (select 1 from fa_kiosk_shift_handovers where id = p_handover_id) then
    raise exception 'PASSAGEM_TURNO_INEXISTENTE';
  end if;

  insert into fa_kiosk_shift_handover_acks
      (handover_id, employee_id, acked_at_ms, acked_in_shift_id, leitura_ms)
    values (p_handover_id, p_employee_id, (extract(epoch from now()) * 1000)::bigint,
            p_shift_id, p_leitura_ms)
    on conflict (handover_id, employee_id) do nothing;

  v_cached := jsonb_build_object('ok', true);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_kiosk_ack_handover', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_ack_handover(text, uuid, uuid, uuid, integer) from public, anon;
grant execute on function fa_kiosk_ack_handover(text, uuid, uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RLS — leitura para autenticado, NENHUMA policy de escrita.
--    Os únicos escritores são as duas funções security definer acima
--    (mesmo precedente de 20260806000009 para as tabelas de auditoria).
--    Passagem de turno é registro: não se edita nem se apaga depois.
-- ---------------------------------------------------------------------
alter table fa_kiosk_shift_handovers enable row level security;
drop policy if exists fa_kiosk_handovers_read on fa_kiosk_shift_handovers;
create policy fa_kiosk_handovers_read on fa_kiosk_shift_handovers
  for select to authenticated using (true);

alter table fa_kiosk_shift_handover_acks enable row level security;
drop policy if exists fa_kiosk_handover_acks_read on fa_kiosk_shift_handover_acks;
create policy fa_kiosk_handover_acks_read on fa_kiosk_shift_handover_acks
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 7. Capacidades (papel MÍNIMO; a herança é resolvida por fa_kiosk_can)
-- ---------------------------------------------------------------------
insert into fa_kiosk_role_capabilities (role, capability) values
  ('OPERADOR', 'caixa.passagem_turno.read'),
  ('GERENTE',  'caixa.passagem_turno.history')
on conflict do nothing;
