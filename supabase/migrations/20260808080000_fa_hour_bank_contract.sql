-- =====================================================================
-- Banco de Horas (planos acima de 2h) + dados do Contratante — FaçaAmigos
-- =====================================================================
-- Regra de negócio (decidida em 2026-08-08):
--
--   * Planos de ATÉ 2h continuam valendo só no dia — nada muda para eles.
--   * Planos ACIMA de 2h deixam de "queimar" as horas não usadas: no
--     fechamento, a sobra vira um crédito de minutos da CRIANÇA, com
--     validade de 45 dias (configurável por unidade).
--   * O crédito vale em QUALQUER unidade de playground: a tabela é
--     escopada por criança, não por unidade — a unidade de origem fica
--     registrada só para relatório.
--   * Na Entrada, quando a criança identificada tem saldo válido, a tela
--     oferece "Usar banco de horas" antes de vender plano novo. A sessão
--     entra sem plano (plan_id nulo) e o fechamento consome os créditos
--     por ordem de vencimento; o que passar do saldo é cobrado pela
--     tarifa de excedente do plano que gerou o crédito.
--   * A trava "este plano não cabe até o fechamento" deixa de valer para
--     planos acima de 2h: a sobra deixa de ser perdida, então não há mais
--     motivo para recusar a venda perto do fechamento.
--
-- Também prepara o contrato de prestação de serviços dos planos >2h:
-- fa_kiosk_guardians ganha RG e endereço (dados do Contratante) e um RPC
-- de atualização — o texto do contrato em si é um modelo editável em
-- fa_kiosk_app_settings ('hour_bank_contract_template'), impresso em A4
-- pelo navegador, não pela térmica.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ledger de créditos do banco de horas
-- ---------------------------------------------------------------------
-- Uma linha por sessão que gerou sobra. `source_session_id` é UNIQUE de
-- propósito: o fechamento pode ser reenviado (fila offline, retry de
-- idempotência) e o crédito não pode nascer duas vezes.
create table if not exists fa_kiosk_hour_bank_credits (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references fa_kiosk_children (id),
  source_session_id uuid not null unique references fa_kiosk_sessions (id),
  source_unit_id uuid not null references fa_kiosk_units (id),
  plan_name_snapshot text not null,
  -- Tarifa de excedente do plano de origem, congelada: se o preço do
  -- plano mudar amanhã, o excedente de quem já tem crédito não muda.
  overage_cents_per_minute integer not null default 0,
  minutes_total integer not null check (minutes_total > 0),
  remaining_minutes integer not null check (remaining_minutes >= 0),
  created_at_ms bigint not null,
  expires_at_ms bigint not null
);
create index if not exists idx_fa_kiosk_hour_bank_credits_child
  on fa_kiosk_hour_bank_credits (child_id, expires_at_ms);

alter table fa_kiosk_hour_bank_credits enable row level security;
drop policy if exists hour_bank_credits_read on fa_kiosk_hour_bank_credits;
create policy hour_bank_credits_read on fa_kiosk_hour_bank_credits
  for select to authenticated using (true);
-- Nenhuma policy de escrita: criar e debitar crédito são passos internos
-- de fa_checkout (security definer), nunca uma escrita solta do app.

comment on table fa_kiosk_hour_bank_credits is
  'Banco de horas: sobra de minutos de planos acima de 2h, por criança, válida em qualquer unidade por 45 dias (hour_bank_validity_days).';


-- ---------------------------------------------------------------------
-- 2. Sessão pode entrar pelo banco de horas (sem plano)
-- ---------------------------------------------------------------------
alter table fa_kiosk_sessions alter column plan_id drop not null;
alter table fa_kiosk_sessions add column if not exists uses_hour_bank boolean not null default false;
-- Saldo válido no instante do check-in (já limitado ao horário de
-- fechamento). É a "duração do plano" da sessão de banco: o Painel conta
-- o tempo contra ele e o fechamento cobra excedente além dele.
alter table fa_kiosk_sessions add column if not exists hour_bank_allocated_minutes integer;
alter table fa_kiosk_sessions add column if not exists hour_bank_overage_cents_per_minute integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fa_kiosk_sessions_plan_or_bank') then
    alter table fa_kiosk_sessions add constraint fa_kiosk_sessions_plan_or_bank
      check (plan_id is not null or uses_hour_bank);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Dados do Contratante (contrato dos planos >2h)
-- ---------------------------------------------------------------------
alter table fa_kiosk_guardians add column if not exists rg text;
alter table fa_kiosk_guardians add column if not exists address_line text;
alter table fa_kiosk_guardians add column if not exists address_city text;
alter table fa_kiosk_guardians add column if not exists address_state text;
alter table fa_kiosk_guardians add column if not exists address_zip text;

-- Atualização via RPC, não por UPDATE direto: as tabelas de pessoas têm
-- RLS restritiva e o app só precisa desta porta estreita.
create or replace function fa_kiosk_guardian_contract_info_update(
  p_guardian_id uuid,
  p_rg text,
  p_email text,
  p_address_line text,
  p_address_city text,
  p_address_state text,
  p_address_zip text
) returns void as $$
begin
  update fa_kiosk_guardians set
    rg = nullif(trim(coalesce(p_rg, '')), ''),
    email = coalesce(nullif(trim(coalesce(p_email, '')), ''), email),
    address_line = nullif(trim(coalesce(p_address_line, '')), ''),
    address_city = nullif(trim(coalesce(p_address_city, '')), ''),
    address_state = nullif(trim(coalesce(p_address_state, '')), ''),
    address_zip = nullif(trim(coalesce(p_address_zip, '')), '')
  where id = p_guardian_id;
  if not found then raise exception 'RESPONSAVEL_NAO_ENCONTRADO'; end if;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

-- Leitura dos dados cadastrais para preencher o contrato na tela.
create or replace function fa_kiosk_guardian_contract_info(p_guardian_id uuid)
returns jsonb as $$
  select jsonb_build_object(
    'id', g.id,
    'fullName', g.full_name,
    'cpf', g.cpf,
    'rg', g.rg,
    'email', g.email,
    'phone', g.phone_e164,
    'addressLine', g.address_line,
    'addressCity', g.address_city,
    'addressState', g.address_state,
    'addressZip', g.address_zip)
  from fa_kiosk_guardians g where g.id = p_guardian_id
$$ language sql stable security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 4. Saldo e consumo do banco de horas
-- ---------------------------------------------------------------------
-- Saldo por criança, SEM filtro de unidade: o crédito vale em qualquer
-- playground. `next_expiry_ms` é o vencimento mais próximo — é o que a
-- Entrada mostra ("vence dd/mm") para o operador avisar a família.
create or replace function fa_kiosk_hour_bank_balance(p_child_ids uuid[])
returns table (child_id uuid, remaining_minutes integer, next_expiry_ms bigint) as $$
  select c.child_id, sum(c.remaining_minutes)::integer, min(c.expires_at_ms)
    from fa_kiosk_hour_bank_credits c
   where c.child_id = any(coalesce(p_child_ids, array[]::uuid[]))
     and c.expires_at_ms > (extract(epoch from now()) * 1000)::bigint
     and c.remaining_minutes > 0
   group by c.child_id
$$ language sql stable security definer set search_path = public, pg_temp;

-- Débito FIFO por vencimento (mesma lógica de fa_kiosk_package_consume):
-- gasta primeiro o crédito que expira antes, senão a criança perde
-- minutos já pagos enquanto sobra crédito novo. Interno do fechamento.
create or replace function fa_kiosk_hour_bank_consume(
  p_child_id uuid, p_minutes integer, p_now_ms bigint
) returns integer as $$
declare
  v_left integer := greatest(0, coalesce(p_minutes, 0));
  v_covered integer := 0;
  v_take integer;
  v_c record;
begin
  if v_left = 0 or p_child_id is null then return 0; end if;
  for v_c in
    select * from fa_kiosk_hour_bank_credits
     where child_id = p_child_id and expires_at_ms > p_now_ms and remaining_minutes > 0
     order by expires_at_ms asc
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_c.remaining_minutes, v_left);
    update fa_kiosk_hour_bank_credits
       set remaining_minutes = remaining_minutes - v_take
     where id = v_c.id;
    v_covered := v_covered + v_take;
    v_left := v_left - v_take;
  end loop;
  return v_covered;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 5. fa_checkin — entrada pelo banco de horas + fim da trava para >2h
-- ---------------------------------------------------------------------
-- Reescrita a partir da versão VIGENTE NO BANCO (que já tem exit_pin),
-- com três mudanças:
--   a) parâmetro novo p_use_hour_bank (default false — apps antigos
--      continuam chamando sem quebrar durante o deploy);
--   b) entrada por saldo: exige criança já cadastrada com saldo válido,
--      grava a sessão sem plano, com o saldo alocado e a tarifa de
--      excedente congelada; cupom é ignorado (não há valor de plano);
--   c) a trava FORA_DO_HORARIO só vale para planos de até 2h — acima
--      disso a sobra vira crédito, então o plano perto do fechamento
--      deixou de ser prejuízo para o cliente.
--
-- DROP obrigatório: `create or replace` com aridade diferente criaria uma
-- SEGUNDA fa_checkin em vez de substituir (ver migration 20260807000007).
drop function if exists fa_checkin(text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[]);

create or replace function fa_checkin(
  p_idempotency_key text,
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_asset_id uuid,
  p_guardian jsonb,
  p_child jsonb,
  p_coupon_code text,
  p_employee_id uuid,
  p_notes text default null,
  p_sensory_tags text[] default null,
  p_use_hour_bank boolean default false
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_closing_time text;
  v_remaining integer;
  v_plan_minutes integer;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_id uuid := null;
  v_coupon_discount_cents integer := 0;
  v_session_id uuid := gen_random_uuid();
  v_access_code text;
  v_exit_pin text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_business_date date;
  v_visits_after integer;
  v_rule record;
  v_bank_balance integer := 0;
  v_bank_allocated integer := null;
  v_bank_overage integer := null;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
  end if;

  if p_use_hour_bank then
    -- Entrada por saldo: só existe para criança já cadastrada — o saldo
    -- é dela, gerado num fechamento anterior (nesta ou noutra unidade).
    v_child_id := nullif(p_child->>'id', '')::uuid;
    if v_child_id is null then raise exception 'BANCO_HORAS_SEM_CADASTRO'; end if;

    select coalesce(sum(remaining_minutes), 0) into v_bank_balance
      from fa_kiosk_hour_bank_credits
     where child_id = v_child_id and expires_at_ms > v_now_ms and remaining_minutes > 0;
    if v_bank_balance <= 0 then raise exception 'BANCO_HORAS_SEM_SALDO'; end if;

    -- Tarifa de excedente do crédito que será consumido primeiro.
    select overage_cents_per_minute into v_bank_overage
      from fa_kiosk_hour_bank_credits
     where child_id = v_child_id and expires_at_ms > v_now_ms and remaining_minutes > 0
     order by expires_at_ms asc limit 1;

    if v_remaining is not null and v_remaining <= 0 then
      raise exception 'FORA_DO_HORARIO: %', 'O shopping já está fechando — não é possível iniciar novas entradas';
    end if;
    -- O tempo disponível hoje é o menor entre o saldo e o que falta até
    -- o fechamento; o que não couber hoje continua no banco.
    v_bank_allocated := case when v_remaining is not null then least(v_bank_balance, v_remaining) else v_bank_balance end;
  else
    select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
    if not found then raise exception 'PLANO_INVALIDO'; end if;

    if v_remaining is not null then
      v_plan_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
      -- Até 2h: precisa caber até o fechamento (a hora não usada se
      -- perderia). Acima de 2h: pode entrar mesmo sem caber — a sobra
      -- vira crédito no fechamento.
      if v_plan_minutes > v_remaining
         and v_plan_minutes <= fa_kiosk_setting_int(p_unit_id, 'hour_bank_threshold_minutes', 120) then
        raise exception 'FORA_DO_HORARIO: %', case when v_remaining > 0
          then format('Este plano não cabe até o fechamento (faltam %s min)', v_remaining)
          else 'O shopping já está fechando — não é possível iniciar novos planos' end;
      end if;
      if v_remaining <= 0 then
        raise exception 'FORA_DO_HORARIO: %', 'O shopping já está fechando — não é possível iniciar novos planos';
      end if;
    end if;
  end if;

  if p_activity = 'CARRINHO' then
    if p_asset_id is null then raise exception 'ASSET_OBRIGATORIO'; end if;
    update fa_kiosk_assets set status = 'EM_USO'
      where id = p_asset_id and status = 'DISPONIVEL';
    if not found then raise exception 'ASSET_INDISPONIVEL'; end if;
  end if;

  v_guardian_id := nullif(p_guardian->>'id', '')::uuid;
  if v_guardian_id is null and p_guardian->>'cpf' is not null then
    select id into v_guardian_id from fa_kiosk_guardians where cpf = p_guardian->>'cpf';
  end if;
  if v_guardian_id is null then
    select id into v_guardian_id from fa_kiosk_guardians where phone_e164 = p_guardian->>'phoneE164';
  end if;
  if v_guardian_id is null then
    insert into fa_kiosk_guardians (full_name, phone_e164, cpf)
      values (p_guardian->>'fullName', p_guardian->>'phoneE164', p_guardian->>'cpf')
      returning id into v_guardian_id;
  end if;

  if v_child_id is null then
    v_child_id := nullif(p_child->>'id', '')::uuid;
  end if;
  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, inclusive_proof_type)
      values (p_child->>'fullName', (p_child->>'birthDate')::date,
              coalesce((p_child->>'inclusiveEligible')::boolean, false), p_child->>'inclusiveProofType')
      returning id into v_child_id;
  end if;

  insert into fa_kiosk_child_guardians (child_id, guardian_id, is_authorized_pickup)
    values (v_child_id, v_guardian_id, true)
    on conflict (child_id, guardian_id) do nothing;

  -- Cupom não se combina com banco de horas: não há valor de plano para
  -- descontar, e queimar o uso do cupom à toa lesaria o cliente.
  if p_coupon_code is not null and not p_use_hour_bank then
    select * into v_coupon from fa_kiosk_coupons
      where unit_id = p_unit_id and code = p_coupon_code and active for update;
    if not found then raise exception 'CUPOM_INVALIDO'; end if;
    update fa_kiosk_coupons set used_count = used_count + 1
      where id = v_coupon.id and (max_uses = 0 or used_count < max_uses);
    if not found then raise exception 'CUPOM_ESGOTADO'; end if;
    if v_coupon.kind = 'DESCONTO_VALOR' then v_coupon_discount_cents := v_coupon.value; end if;
    if v_coupon.kind = 'DESCONTO_PCT' then v_coupon_discount_cents := round(v_plan.value_cents * v_coupon.value / 100.0); end if;
    v_coupon_id := v_coupon.id;
  end if;

  v_access_code := fa_kiosk_new_access_code();
  v_business_date := fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour);
  v_exit_pin := fa_kiosk_new_exit_pin(p_unit_id, v_business_date);

  insert into fa_kiosk_sessions (
    id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
    access_code, exit_pin, wristband_code, ticket_code, notes, sensory_tags,
    checkin_at, checkin_at_ms, checkin_by_employee_id,
    coupon_id, coupon_discount_cents, free_from_loyalty, business_date,
    uses_hour_bank, hour_bank_allocated_minutes, hour_bank_overage_cents_per_minute
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id,
    case when p_use_hour_bank then null else p_plan_id end,
    v_child_id, p_child->>'fullName', v_guardian_id,
    v_access_code, v_exit_pin, v_access_code, v_access_code, nullif(trim(coalesce(p_notes, '')), ''), p_sensory_tags,
    to_timestamp(v_now_ms / 1000.0), v_now_ms, p_employee_id,
    v_coupon_id, v_coupon_discount_cents, false, v_business_date,
    p_use_hour_bank, v_bank_allocated, v_bank_overage
  );

  insert into fa_kiosk_visit_log (child_id, activity, at, at_ms) values (v_child_id, p_activity, to_timestamp(v_now_ms / 1000.0), v_now_ms);
  select count(*) into v_visits_after from fa_kiosk_visit_log where child_id = v_child_id;

  for v_rule in
    select * from fa_kiosk_loyalty_rules
    where unit_id = p_unit_id and active and (activity = p_activity or activity = 'AMBOS')
      and trigger_visits > 0 and v_visits_after % trigger_visits = 0
  loop
    insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms) values (v_child_id, v_rule.id, v_now_ms);
  end loop;

  perform fa_kiosk_enqueue_entry_prints(v_session_id);

  v_cached := jsonb_build_object(
    'sessionId', v_session_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'accessCode', v_access_code, 'exitPin', v_exit_pin,
    'wristbandCode', v_access_code, 'ticketCode', v_access_code,
    'hourBankAllocatedMinutes', v_bank_allocated,
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, extensions, pg_temp;


-- ---------------------------------------------------------------------
-- 6. Impressões da entrada — sessão de banco de horas não tem plano
-- ---------------------------------------------------------------------
-- Mesmo corpo vigente, com o trio nome/valor/duração vindo de variáveis:
-- para sessão de banco, o "plano" impresso é "Banco de Horas", valor 0 e
-- a duração é o saldo alocado (é o horário previsto de saída real).
create or replace function fa_kiosk_enqueue_entry_prints(
  p_session_id uuid
) returns void as $$
declare
  v_s record;
  v_unit record;
  v_plan record;
  v_guardian record;
  v_child record;
  v_employee_name text;
  v_terms text;
  v_entry_time text;
  v_expected_exit text;
  v_notes text;
  v_duration_minutes integer;
  v_plan_name text;
  v_plan_value integer;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then return; end if;

  select * into v_unit from fa_kiosk_units where id = v_s.unit_id;
  select * into v_guardian from fa_kiosk_guardians where id = v_s.guardian_id;
  select * into v_child from fa_kiosk_children where id = v_s.child_id;
  select full_name into v_employee_name from fa_kiosk_employees where id = v_s.checkin_by_employee_id;
  select value into v_terms from fa_kiosk_app_settings where unit_id = v_s.unit_id and key = 'terms_of_use';

  if v_s.uses_hour_bank then
    v_plan_name := 'Banco de Horas';
    v_plan_value := 0;
    v_duration_minutes := coalesce(v_s.hour_bank_allocated_minutes, 0);
  else
    select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;
    v_plan_name := coalesce(v_plan.name, 'Plano');
    v_plan_value := coalesce(v_plan.value_cents, 0);
    v_duration_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
  end if;

  v_entry_time := to_char(to_timestamp(v_s.checkin_at_ms / 1000.0) at time zone 'America/Belem', 'HH24:MI');
  v_expected_exit := to_char(
    (to_timestamp(v_s.checkin_at_ms / 1000.0) + make_interval(mins => v_duration_minutes)) at time zone 'America/Belem',
    'HH24:MI');

  v_notes := nullif(trim(both ' |' from
    coalesce(array_to_string(v_s.sensory_tags, ' | '), '') ||
    case when v_s.notes is not null and v_s.notes <> '' then ' | ' || v_s.notes else '' end), '');

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_s.unit_id, 'WRISTBAND', jsonb_build_object(
    'wristbandCode', v_s.access_code,
    'childName', v_s.child_name_snapshot,
    'guardianName', coalesce(v_guardian.full_name, 'Responsável'),
    'phone', coalesce(v_guardian.phone_e164, ''),
    'planName', v_plan_name,
    'entryTime', v_entry_time,
    'notes', v_notes
  ));

  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_s.unit_id, 'RECEIPT', jsonb_build_object(
    'title', 'Recibo de Guarda',
    'unitName', v_unit.name,
    'unitAddress', v_unit.address,
    'unitPhone', v_unit.phone,
    'unitCnpj', v_unit.cnpj,
    'employeeName', v_employee_name,
    'dateTime', to_char(to_timestamp(v_s.checkin_at_ms / 1000.0) at time zone 'America/Belem', 'DD/MM/YYYY HH24:MI:SS'),
    'accessCode', v_s.access_code,
    'exitPin', v_s.exit_pin,
    'qrValue', v_s.access_code,
    'entryTime', v_entry_time,
    'expectedExitTime', v_expected_exit,
    'planName', v_plan_name,
    'careNotes', v_notes,
    'items', jsonb_build_array(jsonb_build_object(
      'description', v_plan_name, 'quantity', 1, 'amountCents', v_plan_value)),
    'totalCents', v_plan_value,
    'customerInfo', jsonb_build_object(
      'childName', v_s.child_name_snapshot,
      'childBirthDate', to_char(v_child.birth_date, 'DD/MM/YYYY'),
      'guardianName', coalesce(v_guardian.full_name, ''),
      'guardianCpf', v_guardian.cpf,
      'phone', coalesce(v_guardian.phone_e164, '')),
    'footerNote', v_terms
  ));
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 7. fa_checkout — consome e gera crédito do banco de horas
-- ---------------------------------------------------------------------
-- Reescrita a partir da versão VIGENTE NO BANCO (pacotes + itens extras),
-- com duas adições:
--   a) sessão de banco de horas: o tempo brincado sai dos créditos por
--      ordem de vencimento; só o que passar do saldo é cobrado, pela
--      tarifa congelada no check-in. O plano não é cobrado — já foi pago
--      quando o crédito nasceu.
--   b) sessão de plano acima de 2h paga integralmente (sem pacote
--      cobrindo): a sobra de minutos vira crédito da criança, com a
--      validade configurada (45 dias), registrada no cupom para a
--      família ver na hora.
create or replace function fa_checkout(
  p_idempotency_key text,
  p_session_ids uuid[],
  p_payments jsonb,
  p_redeem_reward_ids uuid[],
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_session record;
  v_plan record;
  v_timing jsonb;
  v_total_cents integer := 0;
  v_payments_total integer := 0;
  v_unit_id uuid;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_order_code text := fa_kiosk_next_order_code();
  v_payment jsonb;
  v_index integer := 0;
  v_first_session_id uuid;
  v_reward_id uuid;
  v_free_from_loyalty boolean;
  v_line_cents integer;
  v_applied_discount integer;
  v_valid_employee_id uuid := p_employee_id;
  v_covered jsonb := '{}'::jsonb;
  v_covered_minutes integer;
  v_elapsed_minutes integer;
  v_uncovered_minutes integer;
  v_extra record;
  v_extra_cents integer;
  v_plan_minutes integer;
  v_bank_leftover integer;
  v_bank_validity_days integer;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if v_valid_employee_id is not null and not exists (select 1 from fa_kiosk_employees where id = v_valid_employee_id) then
    select id into v_valid_employee_id from fa_kiosk_employees limit 1;
  end if;

  for v_session in
    select * from fa_kiosk_sessions where id = any(p_session_ids) for update
  loop
    if v_session.status not in ('ATIVA', 'AGUARDANDO_PAGAMENTO') then
      raise exception 'SESSAO_JA_FECHADA: %', v_session.id;
    end if;
    if v_session.paused_at_ms is not null then
      raise exception 'SESSAO_PAUSADA: %', v_session.id;
    end if;
    if v_index = 0 then v_first_session_id := v_session.id; v_unit_id := v_session.unit_id; end if;

    v_free_from_loyalty := (v_index = 0 and array_length(p_redeem_reward_ids, 1) > 0);
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) / 60000.0)::integer);

    if v_session.uses_hour_bank then
      -- Débito do banco: acontece UMA vez, aqui; o segundo laço (itens)
      -- reusa o número via v_covered, senão debitaria em dobro.
      v_covered_minutes := fa_kiosk_hour_bank_consume(v_session.child_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      v_line_cents := v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0);
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));
      v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));

      if v_covered_minutes > 0 then
        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
        v_line_cents := v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0);
      else
        v_line_cents := (v_timing->>'liveTotalCents')::integer;
      end if;
    end if;
    v_total_cents := v_total_cents + v_line_cents;

    if coalesce(v_session.coupon_discount_cents, 0) > 0 then
      v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

    select coalesce(sum(quantity * unit_price_cents), 0) into v_extra_cents
      from fa_kiosk_session_extra_items where session_id = v_session.id and order_id is null;
    v_total_cents := v_total_cents + v_extra_cents;

    update fa_kiosk_sessions set status = 'AGUARDANDO_PAGAMENTO' where id = v_session.id;
    v_index := v_index + 1;
  end loop;

  if v_index <> array_length(p_session_ids, 1) then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_total_cents then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_total_cents, v_payments_total;
  end if;

  select * into v_shift from fa_kiosk_shifts where unit_id = v_unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code)
    values (v_order_id, v_unit_id, v_shift.id, 'SESSAO', v_total_cents, 'ABERTA', v_shift.business_date, v_order_code);

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    v_covered_minutes := coalesce((v_covered->>v_session.id::text)::integer, 0);
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) / 60000.0)::integer);

    if v_session.uses_hour_bank then
      -- Linha de valor zero, mas explícita: a família precisa ver
      -- quantos minutos saíram do banco de horas dela.
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s min do banco de horas', v_session.child_name_snapshot, v_covered_minutes), 1,
          0, 0, 0, v_session.id);

      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      if v_uncovered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Além do banco de horas (%s min)', v_uncovered_minutes), 1,
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0), v_session.id);
      end if;
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));

      if v_covered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO',
            format('%s — %s min do pacote', v_session.child_name_snapshot, v_covered_minutes), 1,
            0, coalesce(v_plan.value_cents, 0), 0, v_session.id);

        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
        if v_uncovered_minutes > 0 then
          insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
            values (v_order_id, 'SESSAO', 'SERVICO', format('Além do saldo (%s min)', v_uncovered_minutes), 1,
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0),
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0),
              v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0), v_session.id);
        end if;
      else
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('%s — %s', v_session.child_name_snapshot, coalesce(v_plan.name, 'Plano')), 1,
            coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), v_session.id);
        if (v_timing->>'overMinutes')::integer > 0 then
          insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
            values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
              (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
        end if;

        -- Banco de horas: plano acima de 2h pago integralmente e criança
        -- saiu antes do teto — a sobra vira crédito dela, em qualquer
        -- unidade, pela validade configurada.
        v_plan_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
        if v_plan_minutes > fa_kiosk_setting_int(v_session.unit_id, 'hour_bank_threshold_minutes', 120) then
          v_bank_leftover := v_plan_minutes - least(v_plan_minutes, v_elapsed_minutes);
          if v_bank_leftover >= 1 then
            v_bank_validity_days := fa_kiosk_setting_int(v_session.unit_id, 'hour_bank_validity_days', 45);
            insert into fa_kiosk_hour_bank_credits (
              child_id, source_session_id, source_unit_id, plan_name_snapshot,
              overage_cents_per_minute, minutes_total, remaining_minutes, created_at_ms, expires_at_ms
            ) values (
              v_session.child_id, v_session.id, v_session.unit_id, coalesce(v_plan.name, 'Plano'),
              coalesce(v_plan.overage_cents_per_minute, 0), v_bank_leftover, v_bank_leftover,
              v_now_ms, v_now_ms + v_bank_validity_days::bigint * 86400000
            ) on conflict (source_session_id) do nothing;

            insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
              values (v_order_id, 'SESSAO', 'SERVICO',
                format('Banco de horas: +%s min (vale %s dias, em qualquer unidade)', v_bank_leftover, v_bank_validity_days), 1,
                0, 0, 0, v_session.id);
          end if;
        end if;
      end if;
    end if;

    for v_extra in select ei.*, p.name as product_name from fa_kiosk_session_extra_items ei
      join fa_kiosk_products p on p.id = ei.product_id
      where ei.session_id = v_session.id and ei.order_id is null
    loop
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, product_id, session_id)
        values (v_order_id, 'PRODUTO', 'PRODUTO', v_extra.product_name, v_extra.quantity,
          v_extra.unit_price_cents, v_extra.unit_price_cents, v_extra.quantity * v_extra.unit_price_cents,
          v_extra.product_id, v_session.id);
      update fa_kiosk_session_extra_items set order_id = v_order_id where id = v_extra.id;
    end loop;
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders set status = 'PAGA', closed_by_employee_id = v_valid_employee_id, closed_at_ms = v_now_ms where id = v_order_id;

  for v_session in select * from fa_kiosk_sessions where id = any(p_session_ids) loop
    update fa_kiosk_sessions set status = 'FINALIZADA', checkout_at_ms = v_now_ms, order_id = v_order_id where id = v_session.id;
    if v_session.asset_id is not null then
      update fa_kiosk_assets set status = 'DISPONIVEL',
        odometer_minutes = odometer_minutes + ceil((v_now_ms - coalesce(v_session.checkin_at_ms, v_now_ms)) / 60000.0)
        where id = v_session.asset_id;
    end if;
  end loop;

  foreach v_reward_id in array coalesce(p_redeem_reward_ids, array[]::uuid[]) loop
    update fa_kiosk_loyalty_rewards set redeemed_at_ms = v_now_ms, redeemed_session_id = v_first_session_id
      where id = v_reward_id and redeemed_at_ms is null;
  end loop;

  v_cached := jsonb_build_object('orderId', v_order_id, 'orderCode', v_order_code, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkout', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, extensions, pg_temp;


-- ---------------------------------------------------------------------
-- 8. Permissões
-- ---------------------------------------------------------------------
-- Padrão do projeto: funções novas nascem executáveis por PUBLIC (default
-- do PostgreSQL) — cada uma precisa do par revoke/grant explícito.
do $$
declare
  r text;
  fns text[] := array[
    'fa_kiosk_hour_bank_balance(uuid[])',
    'fa_kiosk_hour_bank_consume(uuid, integer, bigint)',
    'fa_kiosk_guardian_contract_info_update(uuid, text, text, text, text, text, text)',
    'fa_kiosk_guardian_contract_info(uuid)',
    'fa_checkin(text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[], boolean)',
    'fa_checkout(text, uuid[], jsonb, uuid[], uuid)',
    'fa_kiosk_enqueue_entry_prints(uuid)'
  ];
begin
  foreach r in array fns loop
    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

-- Debitar o banco de horas e enfileirar impressão são passos internos do
-- fechamento/check-in — expostos, qualquer sessão autenticada zeraria o
-- saldo de uma criança ou spammaria a impressora.
revoke execute on function fa_kiosk_hour_bank_consume(uuid, integer, bigint) from authenticated;
revoke execute on function fa_kiosk_enqueue_entry_prints(uuid) from authenticated;
