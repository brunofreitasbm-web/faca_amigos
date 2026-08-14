-- ATENÇÃO — corrige drift de banco (mesmo padrão do incidente descrito em
-- 20260810000003/4): as migrações 20260814160048 (fa_pre_checkin_pin_fix) e
-- 20260814160102 (fa_pre_checkin_pin_status_list) foram aplicadas direto no
-- projeto Supabase sem nunca virar arquivo neste repo. Pior: elas deixaram
-- fa_pre_checkin_submit/status/list chamando uma coluna `pin` e uma função
-- `fa_kiosk_new_pre_checkin_pin(uuid)` que NUNCA existiram de verdade — ou
-- seja, o QR de Acesso Rápido está 100% quebrado em produção (todo envio
-- falha com "function does not exist") desde que 160048 foi aplicada. Esta
-- migração recria as 3 funções do zero (já com o formato de lista de
-- crianças abaixo) e adiciona a coluna `pin` que faltava — resolve a
-- quebra E entrega os 3 pedidos abaixo num só deploy.
--
-- Acesso Rápido ganha 3 ajustes pedidos junto com a UI (AcessoRapidoScreen):
--
-- 1) Múltiplas crianças por pré-cadastro (botão "+" na tela pública) — a
--    família inteira (irmãos) manda um único pré-cadastro com um
--    responsável/CPF/telefone/plano só, mas uma criança por item da lista
--    `children`. Cada criança é convertida em check-in separadamente pelo
--    operador (cada uma ganha sua própria pulseira/sessão) — por isso
--    `conversions` guarda, por índice de criança, qual `session_id` já foi
--    aberto; o pré-cadastro só vira CONVERTIDO quando a última criança é
--    confirmada no balcão.
-- 2) CPF do responsável passa a ser obrigatório (antes era opcional).
-- 3) O PIN de 4 dígitos que a tela pública já exibia (`res.pin`,
--    AcessoRapidoScreen) nunca existiu de verdade no banco — era sempre
--    `undefined`. Criado aqui de verdade: gerado no submit, devolvido no
--    retorno e também na lista/consulta de status, para o balcão casar a
--    família certa com o card certo.
--
-- Superfície pública continua mínima (mesmo padrão de 20260814000001):
-- nenhuma policy de RLS nova para anon/authenticated — só as RPCs.
-- ---------------------------------------------------------------------------

-- 0) Migra as colunas antigas (uma criança só) para o formato de lista.
alter table fa_kiosk_pre_checkins
  add column if not exists children jsonb,
  add column if not exists conversions jsonb not null default '{}'::jsonb,
  add column if not exists pin text;

update fa_kiosk_pre_checkins
set children = jsonb_build_array(jsonb_build_object(
  'childName', child_name,
  'birthDate', birth_date,
  'inclusiveEligible', coalesce(inclusive_eligible, false),
  'sensoryTags', coalesce(to_jsonb(sensory_tags), '[]'::jsonb),
  'notes', notes
))
where children is null;

update fa_kiosk_pre_checkins set pin = lpad((floor(random() * 10000))::int::text, 4, '0') where pin is null;

-- Pré-existentes sem CPF (era opcional) recebem um placeholder óbvio em vez
-- de travar a migração — não há dado de cliente real a perder nesta fase.
update fa_kiosk_pre_checkins set cpf = '00000000000' where cpf is null;

alter table fa_kiosk_pre_checkins
  alter column children set not null,
  alter column pin set not null,
  alter column cpf set not null,
  drop column if exists child_name,
  drop column if exists birth_date,
  drop column if exists inclusive_eligible,
  drop column if exists sensory_tags,
  drop column if exists notes;

-- ---------------------------------------------------------------------------
-- 1) Submit: agora recebe `p_children` (array), CPF obrigatório, devolve PIN.
-- ---------------------------------------------------------------------------
drop function if exists fa_pre_checkin_submit(uuid, text, uuid, text, date, text, text, text, boolean, boolean, text[], text);

create or replace function fa_pre_checkin_submit(
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_children jsonb,
  p_guardian_name text,
  p_cpf text,
  p_phone_e164 text,
  p_terms_accepted boolean
) returns jsonb as $$
declare
  v_id uuid;
  v_plan record;
  v_pin text;
  v_child jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_cpf_digits text;
begin
  if p_children is null or jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) = 0 then
    raise exception 'CRIANCA_OBRIGATORIA';
  end if;
  if jsonb_array_length(p_children) > 6 then
    raise exception 'MUITAS_CRIANCAS';
  end if;

  for v_child in select * from jsonb_array_elements(p_children) loop
    if coalesce(btrim(v_child ->> 'childName'), '') = '' then raise exception 'NOME_CRIANCA_OBRIGATORIO'; end if;
    if (v_child ->> 'birthDate') is null or (v_child ->> 'birthDate')::date is null then
      raise exception 'NASCIMENTO_OBRIGATORIO';
    end if;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'childName', btrim(v_child ->> 'childName'),
      'birthDate', (v_child ->> 'birthDate')::date,
      'inclusiveEligible', coalesce((v_child ->> 'inclusiveEligible')::boolean, false),
      'sensoryTags', coalesce(v_child -> 'sensoryTags', '[]'::jsonb),
      'notes', nullif(btrim(coalesce(v_child ->> 'notes', '')), '')
    ));
  end loop;

  if coalesce(btrim(p_guardian_name), '') = '' then raise exception 'NOME_RESPONSAVEL_OBRIGATORIO'; end if;

  v_cpf_digits := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf_digits) <> 11 then raise exception 'CPF_OBRIGATORIO'; end if;

  if p_phone_e164 is null or length(regexp_replace(p_phone_e164, '\D', '', 'g')) < 10 then
    raise exception 'TELEFONE_INVALIDO';
  end if;
  if not coalesce(p_terms_accepted, false) then
    raise exception 'TERMOS_NAO_ACEITOS';
  end if;

  select * into v_plan from fa_kiosk_plans
    where id = p_plan_id and unit_id = p_unit_id and activity = p_activity and active;
  if not found then raise exception 'PLANO_INVALIDO'; end if;

  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  insert into fa_kiosk_pre_checkins (
    unit_id, activity, plan_id, children, guardian_name, cpf, phone_e164, terms_accepted_at_ms, pin
  ) values (
    p_unit_id, p_activity, p_plan_id, v_normalized, btrim(p_guardian_name),
    v_cpf_digits, p_phone_e164, (extract(epoch from now()) * 1000)::bigint, v_pin
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'pin', v_pin);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_submit(uuid, text, uuid, jsonb, text, text, text, boolean) from public;
grant execute on function fa_pre_checkin_submit(uuid, text, uuid, jsonb, text, text, text, boolean) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Status: devolve o PIN de verdade e uma sessão por criança já
--    convertida (em vez de um `accessCode` só, que não sobrevive a mais de
--    uma criança).
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_status(p_id uuid) returns jsonb as $$
declare
  v_row record;
  v_sessions jsonb;
begin
  select * into v_row from fa_kiosk_pre_checkins where id = p_id;
  if not found then raise exception 'PRE_CADASTRO_NAO_ENCONTRADO'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'childIndex', (kv.key)::int,
    'childName', v_row.children -> (kv.key)::int ->> 'childName',
    'accessCode', s.access_code
  ) order by (kv.key)::int), '[]'::jsonb)
  into v_sessions
  from jsonb_each_text(v_row.conversions) kv
  join fa_kiosk_sessions s on s.id = (kv.value)::uuid;

  return jsonb_build_object(
    'status', v_row.status,
    'pin', v_row.pin,
    'totalChildren', jsonb_array_length(v_row.children),
    'sessions', v_sessions
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 3) Lista do balcão: uma linha por CRIANÇA ainda não convertida (não mais
--    por pré-cadastro) — cada uma abre a Entrada já preenchida e confirma
--    separadamente, ganhando sua própria pulseira.
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
    'childIndex', child.idx - 1,
    'totalChildren', jsonb_array_length(pc.children),
    'activity', pc.activity,
    'planId', pc.plan_id,
    'planName', p.name,
    'childName', child.value ->> 'childName',
    'birthDate', child.value ->> 'birthDate',
    'guardianName', pc.guardian_name,
    'cpf', pc.cpf,
    'phoneE164', pc.phone_e164,
    'inclusiveEligible', coalesce((child.value ->> 'inclusiveEligible')::boolean, false),
    'sensoryTags', coalesce((
      select array_agg(tag) from jsonb_array_elements_text(child.value -> 'sensoryTags') tag
    ), '{}'),
    'notes', child.value ->> 'notes',
    'pin', pc.pin,
    'createdAtMs', pc.created_at_ms
  ) order by pc.created_at_ms asc, child.idx asc), '[]'::jsonb)
  into v_rows
  from fa_kiosk_pre_checkins pc
  join fa_kiosk_plans p on p.id = pc.plan_id
  cross join lateral jsonb_array_elements(pc.children) with ordinality as child(value, idx)
  where pc.unit_id = p_unit_id
    and pc.status = 'PENDENTE'
    and not (pc.conversions ? (child.idx - 1)::text);

  return v_rows;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 4) Cancelar: continua exigindo só `status = 'PENDENTE'` (igual antes) —
--    mesmo com alguma criança já convertida, o pré-cadastro inteiro só
--    fecha CONVERTIDO quando TODAS convertem, então cancelar aqui só some
--    com as crianças que ainda faltavam aparecer na lista; a sessão de
--    quem já ganhou pulseira não é tocada (ela vive em fa_kiosk_sessions,
--    independente).
-- ---------------------------------------------------------------------------
create or replace function fa_pre_checkin_cancel(p_id uuid, p_employee_id uuid) returns void as $$
begin
  if not fa_kiosk_can('sessao.checkin') then
    raise exception 'sem permissão para cancelar pré-cadastro' using errcode = '42501';
  end if;
  update fa_kiosk_pre_checkins
    set status = 'CANCELADO'
    where id = p_id and status = 'PENDENTE';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 5) fa_checkin ganha `p_pre_checkin_child_index` (default null, no fim —
--    mesmo truque das migrações anteriores: função nova só de acréscimo de
--    parâmetro herda o grant padrão a PUBLIC, sem precisar regravar).
--    Marca a criança daquele índice como convertida e só fecha o
--    pré-cadastro inteiro (CONVERTIDO) quando todas já tiverem sessão.
-- ---------------------------------------------------------------------------
drop function if exists fa_checkin(text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[], boolean, uuid);

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
  p_pre_checkin_id uuid default null,
  p_pre_checkin_child_index int default null
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
  v_conversion_key text;
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
    v_conversion_key := coalesce(p_pre_checkin_child_index, 0)::text;
    update fa_kiosk_pre_checkins
      set conversions = conversions || jsonb_build_object(v_conversion_key, v_session_id::text)
      where id = p_pre_checkin_id and status = 'PENDENTE' and not (conversions ? v_conversion_key);

    update fa_kiosk_pre_checkins
      set status = 'CONVERTIDO'
      where id = p_pre_checkin_id and status = 'PENDENTE'
        and (select count(*) from jsonb_object_keys(conversions)) >= jsonb_array_length(children);
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
