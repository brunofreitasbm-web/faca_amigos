-- QR Code de Acesso Rápido: cartaz fixo na entrada de cada unidade. O
-- responsável escaneia, preenche os dados que hoje o operador digita na
-- Entrada (criança, responsável, plano) e aceita os Termos de Uso — sem
-- login, sem conta. Isso só cria um PRÉ-cadastro (esta tabela nova); o
-- check-in de verdade (pulseira, recibo, access_code, início da contagem)
-- continua 100% pelo fa_checkin de sempre, disparado pelo operador no
-- balcão a partir da EntradaScreen já preenchida.
--
-- Superfície pública deliberadamente mínima, seguindo o padrão endurecido
-- em 20260810000003/4 (nunca SELECT direto de tabela para `anon` — só
-- RPCs SECURITY DEFINER, de propriedade de `postgres`, com BYPASSRLS e
-- grant explícito): fa_kiosk_pre_checkins não recebe NENHUMA policy de
-- RLS para anon/authenticated, e o default ACL já revoga `anon` de
-- tabelas novas por padrão (20260810000003) — só estas RPCs enxergam a
-- tabela.
create table if not exists fa_kiosk_pre_checkins (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null check (activity in ('PLAYGROUND', 'CARRINHO')),
  plan_id uuid not null references fa_kiosk_plans (id),
  child_name text not null,
  birth_date date not null,
  guardian_name text not null,
  cpf text,
  phone_e164 text not null,
  inclusive_eligible boolean not null default false,
  sensory_tags text[],
  notes text,
  terms_accepted_at_ms bigint not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'CONVERTIDO', 'CANCELADO')),
  session_id uuid references fa_kiosk_sessions (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_kiosk_pre_checkins enable row level security;

create index if not exists fa_kiosk_pre_checkins_unit_status_idx
  on fa_kiosk_pre_checkins (unit_id, status, created_at_ms);

-- ---------------------------------------------------------------------------
-- 1) Opções do formulário público: nome/atividade da unidade, planos ativos
--    e o texto de Termos de Uso já mantido em fa_kiosk_app_settings (mesmo
--    que a aba "Termos de Uso" do Gerencial edita e que já sai impresso no
--    recibo — ver 20260807000005/20260807000007). Sem PII nenhuma.
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_form_options(p_unit_id uuid) returns jsonb as $$
declare
  v_unit record;
  v_activity text;
  v_plans jsonb;
  v_terms text;
begin
  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  v_activity := case when v_unit.kind = 'QUIOSQUE' then 'CARRINHO' else 'PLAYGROUND' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'valueCents', p.value_cents,
    'durationValue', p.duration_value,
    'durationUnit', p.duration_unit,
    'color', p.color
  ) order by p.value_cents), '[]'::jsonb)
  into v_plans
  from fa_kiosk_plans p
  where p.unit_id = p_unit_id and p.activity = v_activity and p.active;

  select value into v_terms from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'terms_of_use';

  return jsonb_build_object(
    'unitName', v_unit.name,
    'activity', v_activity,
    'plans', v_plans,
    'termsText', coalesce(v_terms, '')
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_form_options(uuid) from public;
grant execute on function fa_pre_checkin_form_options(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Envio do pré-cadastro pelo responsável. Não toca em guardians/children/
--    sessions — isso só acontece no fa_checkin real, quando o operador
--    confirma no balcão (evita poluir o cadastro com pré-cadastros nunca
--    convertidos, e evita qualquer escrita anônima nas tabelas de PII).
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_submit(
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_child_name text,
  p_birth_date date,
  p_guardian_name text,
  p_cpf text,
  p_phone_e164 text,
  p_terms_accepted boolean,
  p_inclusive_eligible boolean default false,
  p_sensory_tags text[] default null,
  p_notes text default null
) returns uuid as $$
declare
  v_id uuid;
  v_plan record;
begin
  if coalesce(btrim(p_child_name), '') = '' then raise exception 'NOME_CRIANCA_OBRIGATORIO'; end if;
  if p_birth_date is null then raise exception 'NASCIMENTO_OBRIGATORIO'; end if;
  if coalesce(btrim(p_guardian_name), '') = '' then raise exception 'NOME_RESPONSAVEL_OBRIGATORIO'; end if;
  if p_phone_e164 is null or length(regexp_replace(p_phone_e164, '\D', '', 'g')) < 10 then
    raise exception 'TELEFONE_INVALIDO';
  end if;
  if not coalesce(p_terms_accepted, false) then
    raise exception 'TERMOS_NAO_ACEITOS';
  end if;

  select * into v_plan from fa_kiosk_plans
    where id = p_plan_id and unit_id = p_unit_id and activity = p_activity and active;
  if not found then raise exception 'PLANO_INVALIDO'; end if;

  insert into fa_kiosk_pre_checkins (
    unit_id, activity, plan_id, child_name, birth_date, guardian_name, cpf, phone_e164,
    inclusive_eligible, sensory_tags, notes, terms_accepted_at_ms
  ) values (
    p_unit_id, p_activity, p_plan_id, btrim(p_child_name), p_birth_date, btrim(p_guardian_name),
    nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''), p_phone_e164,
    coalesce(p_inclusive_eligible, false), p_sensory_tags, nullif(btrim(coalesce(p_notes, '')), ''),
    (extract(epoch from now()) * 1000)::bigint
  ) returning id into v_id;

  return v_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_submit(uuid, text, uuid, text, date, text, text, text, boolean, boolean, text[], text) from public;
grant execute on function fa_pre_checkin_submit(uuid, text, uuid, text, date, text, text, text, boolean, boolean, text[], text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Status pontual, só para quem já tem o `id` (devolvido no passo 2) —
--    não é uma listagem: não dá para descobrir outros pré-cadastros por
--    aqui. A tela pública faz poll nesta função para saber quando o
--    operador confirmou a entrada e trocar sozinha para o painel de
--    acompanhamento (?acompanhar=<accessCode>), sem precisar ler o QR da
--    pulseira/recibo.
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_status(p_id uuid) returns jsonb as $$
declare
  v_row record;
  v_access_code text;
begin
  select * into v_row from fa_kiosk_pre_checkins where id = p_id;
  if not found then raise exception 'PRE_CADASTRO_NAO_ENCONTRADO'; end if;

  if v_row.session_id is not null then
    select access_code into v_access_code from fa_kiosk_sessions where id = v_row.session_id;
  end if;

  return jsonb_build_object('status', v_row.status, 'accessCode', v_access_code);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_status(uuid) from public;
grant execute on function fa_pre_checkin_status(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Lista de pendentes para o Painel/Entrada do operador. Mesma capacidade
--    que já abre a tela de Entrada (sessao.checkin) — quem pode fazer
--    check-in manual pode revisar e confirmar um pré-cadastro.
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_list(p_unit_id uuid) returns jsonb as $$
declare
  v_rows jsonb;
begin
  if not fa_kiosk_can('sessao.checkin') then
    raise exception 'sem permissão para ver pré-cadastros' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id,
    'activity', pc.activity,
    'planId', pc.plan_id,
    'planName', p.name,
    'childName', pc.child_name,
    'birthDate', pc.birth_date,
    'guardianName', pc.guardian_name,
    'cpf', pc.cpf,
    'phoneE164', pc.phone_e164,
    'inclusiveEligible', pc.inclusive_eligible,
    'sensoryTags', pc.sensory_tags,
    'notes', pc.notes,
    'createdAtMs', pc.created_at_ms
  ) order by pc.created_at_ms asc), '[]'::jsonb)
  into v_rows
  from fa_kiosk_pre_checkins pc
  join fa_kiosk_plans p on p.id = pc.plan_id
  where pc.unit_id = p_unit_id and pc.status = 'PENDENTE';

  return v_rows;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_list(uuid) from public, anon;
grant execute on function fa_pre_checkin_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Descartar um pré-cadastro pendente (duplicado, desistência, etc).
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_cancel(p_id uuid, p_employee_id uuid) returns void as $$
begin
  if not fa_kiosk_can('sessao.checkin') then
    raise exception 'sem permissão para cancelar pré-cadastro' using errcode = '42501';
  end if;
  update fa_kiosk_pre_checkins set status = 'CANCELADO' where id = p_id and status = 'PENDENTE';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_cancel(uuid, uuid) from public, anon;
grant execute on function fa_pre_checkin_cancel(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) fa_checkin ganha um parâmetro novo (default null, no fim da lista —
--    mesmo truque de 20260812000002 para preservar os grants existentes
--    sem precisar regravá-los): quando o check-in confirmado no balcão
--    nasceu de um pré-cadastro, marca a origem como CONVERTIDO na mesma
--    transação. Corpo idêntico ao de 20260812000002 fora deste trecho.
-- ---------------------------------------------------------------------------
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
  p_use_hour_bank boolean default false,
  p_pre_checkin_id uuid default null
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
    if v_coupon.allowed_plan_id is not null and v_coupon.allowed_plan_id <> p_plan_id then
      raise exception 'CUPOM_PLANO_INVALIDO: %', 'Este cupom não é válido para o plano selecionado';
    end if;
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

  if p_pre_checkin_id is not null then
    update fa_kiosk_pre_checkins set status = 'CONVERTIDO', session_id = v_session_id
      where id = p_pre_checkin_id and status = 'PENDENTE';
  end if;

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
