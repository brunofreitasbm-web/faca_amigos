-- =====================================================================
-- Controle de Entrada e Saída — FaçaAmigos
-- =====================================================================
-- Fecha o ciclo de balcão inteiro numa única transação por operação:
--
--   ENTRADA   fa_checkin() passa a gerar o código de acesso curto da
--             criança E a enfileirar as DUAS impressões (pulseira
--             Gainscha + recibo de guarda 80mm) dentro da mesma
--             transação. Se o check-in gravou, as duas vias saem; se
--             falhou, nenhuma sai meia-impressa.
--
--   SAÍDA     fa_resolve_access_code() traduz o que a câmera do celular
--             leu para uma sessão ativa, com verificação de dígito e
--             registro de auditoria.
--
--   SAÍDA     fa_saida_manual_authorize() é a contingência de recibo
--   MANUAL    perdido/etiqueta danificada: libera pela conferência do
--             documento do responsável cadastrado, deixando registrado
--             quem liberou, contra qual documento e por quê.
--
-- Também corrige três defeitos herdados (ver blocos 0, 5 e 7).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Correção: fa_kiosk_hmac8 nunca truncou
-- ---------------------------------------------------------------------
-- O nome promete 8 caracteres, o corpo devolvia os 64 do sha256 em hex.
-- Era isso que inflava o payload da pulseira para ~101 caracteres e
-- empurrava o QR para uma versão densa demais para a câmera de celular.
-- Nada no sistema confere esses códigos antigos (não havia busca por
-- código), então encurtar aqui não invalida sessão nenhuma.
create or replace function fa_kiosk_hmac8(p_value text) returns text as $$
  select substring(
    encode(extensions.hmac(p_value::bytea, (select value from fa_kiosk_secrets where key = 'wristband_hmac_key')::bytea, 'sha256'::text), 'hex')
    from 1 for 8
  );
$$ language sql stable security definer;


-- ---------------------------------------------------------------------
-- 1. Código de acesso curto, aleatório e verificável
-- ---------------------------------------------------------------------
-- Formato: 8 caracteres aleatórios + 3 caracteres de verificação = 11.
--
-- Alfabeto Crockford Base32 (0-9 A-Z sem I, L, O, U):
--   * sem I/L/1 e O/0 confundíveis na leitura humana do balcão;
--   * sem U, que evita palavrões acidentais em português;
--   * inteiramente dentro do conjunto alfanumérico do QR Code, o que
--     permite o modo de codificação compacto (5,5 bits/caractere em vez
--     de 8). 11 caracteres cabem na VERSÃO 1 do QR mesmo com correção de
--     erro Q — 21x21 módulos, o menor QR que existe. É isso que dá
--     leitura instantânea na câmera e impressão nítida em 203 DPI.
--
-- Segurança: 8 caracteres aleatórios = 32^8 ≈ 1,1 trilhão de combinações,
-- sorteadas de gen_random_bytes (CSPRNG), nunca sequenciais. Os 3
-- caracteres finais são derivados de HMAC-SHA256 com segredo que nunca
-- sai do banco: um código inventado no papel é rejeitado antes mesmo de
-- consultar a tabela de sessões, e não há como gerar um válido sem o
-- segredo. Para 60 crianças/mês, a chance de colisão é desprezível — e
-- ainda assim o gerador confere unicidade no banco antes de devolver.

insert into fa_kiosk_secrets (key, value)
values ('access_code_hmac_key', md5(random()::text || clock_timestamp()::text) || md5(random()::text || gen_random_uuid()::text))
on conflict (key) do nothing;

create or replace function fa_kiosk_code_alphabet() returns text as $$
  select '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
$$ language sql immutable;

-- Caracteres aleatórios criptográficos. 256 é múltiplo exato de 32, então
-- o resto da divisão não introduz viés para nenhuma letra.
create or replace function fa_kiosk_random_code(p_length integer) returns text as $$
declare
  v_alphabet text := fa_kiosk_code_alphabet();
  v_bytes bytea := extensions.gen_random_bytes(p_length);
  v_out text := '';
  i integer;
begin
  for i in 0 .. p_length - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$ language plpgsql volatile;

create or replace function fa_kiosk_code_checksum(p_body text, p_length integer default 3) returns text as $$
declare
  v_alphabet text := fa_kiosk_code_alphabet();
  v_digest bytea := extensions.hmac(p_body::bytea, (select value from fa_kiosk_secrets where key = 'access_code_hmac_key')::bytea, 'sha256'::text);
  v_out text := '';
  i integer;
begin
  for i in 0 .. p_length - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_digest, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$ language plpgsql stable security definer;

-- Normalização na leitura: aceita o que o operador digitou com hífen,
-- espaço ou minúscula, e desfaz as confusões clássicas de leitura manual
-- (I/L lidos como 1, O lido como 0) da forma canônica do Crockford. O `U`
-- não é remapeado de propósito: ele não existe no alfabeto, então um código
-- com U simplesmente reprova no dígito verificador, como deve.
create or replace function fa_kiosk_normalize_access_code(p_raw text) returns text as $$
  select translate(
    regexp_replace(upper(coalesce(p_raw, '')), '[^0-9A-Z]', '', 'g'),
    'ILO', '110')
$$ language sql immutable;

create or replace function fa_kiosk_verify_access_code(p_raw text) returns boolean as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_raw);
begin
  if length(v_code) <> 11 then return false; end if;
  return substring(v_code from 9 for 3) = fa_kiosk_code_checksum(substring(v_code from 1 for 8), 3);
end;
$$ language plpgsql stable security definer;

create or replace function fa_kiosk_new_access_code() returns text as $$
declare
  v_body text;
  v_code text;
  v_tries integer := 0;
begin
  loop
    v_body := fa_kiosk_random_code(8);
    v_code := v_body || fa_kiosk_code_checksum(v_body, 3);
    exit when not exists (select 1 from fa_kiosk_sessions where access_code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'CODIGO_ACESSO_INDISPONIVEL'; end if;
  end loop;
  return v_code;
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 2. Colunas novas da sessão
-- ---------------------------------------------------------------------
-- access_code    identidade física da criança no parque (pulseira e recibo
--                carregam o MESMO código: são duas vias do mesmo bilhete,
--                para que a perda de uma não impeça a saída pela outra).
-- notes          observações livres da entrada.
-- sensory_tags   cuidados inclusivos escolhidos no balcão. Até hoje a tela
--                de Entrada montava essas tags e as descartava em silêncio,
--                porque não havia coluna nem parâmetro para recebê-las —
--                e o Painel e a etiqueta já liam um `notes` que nunca era
--                preenchido. Passa a existir de verdade.
alter table fa_kiosk_sessions add column if not exists access_code text;
alter table fa_kiosk_sessions add column if not exists notes text;
alter table fa_kiosk_sessions add column if not exists sensory_tags text[];

create unique index if not exists idx_fa_kiosk_sessions_access_code
  on fa_kiosk_sessions (access_code) where access_code is not null;

-- Sessões que já estavam no parque quando esta migração rodou continuam
-- com a pulseira antiga impressa na mão da criança. Ganham um código novo
-- para poderem ser reimpressas e lidas — e o resolvedor abaixo continua
-- aceitando o payload antigo delas até irem embora.
do $$
declare r record;
begin
  for r in select id from fa_kiosk_sessions where access_code is null and status <> 'FINALIZADA' loop
    update fa_kiosk_sessions set access_code = fa_kiosk_new_access_code() where id = r.id;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 3. Montagem das duas vias impressas
-- ---------------------------------------------------------------------
-- Os dois payloads são montados aqui, no banco, e não no navegador, por
-- três motivos: saem na mesma transação do check-in (ou tudo, ou nada);
-- não dependem do terminal ficar aberto até a impressora responder; e o
-- conteúdo do recibo de guarda — que é a via de defesa jurídica do parque
-- — passa a ter uma origem única, não uma cópia por tela.

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
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then return; end if;

  select * into v_unit from fa_kiosk_units where id = v_s.unit_id;
  select * into v_plan from fa_kiosk_plans where id = v_s.plan_id;
  select * into v_guardian from fa_kiosk_guardians where id = v_s.guardian_id;
  select * into v_child from fa_kiosk_children where id = v_s.child_id;
  select full_name into v_employee_name from fa_kiosk_employees where id = v_s.checkin_by_employee_id;
  select value into v_terms from fa_kiosk_app_settings where unit_id = v_s.unit_id and key = 'terms_of_use';

  v_duration_minutes := fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit);
  v_entry_time := to_char(to_timestamp(v_s.checkin_at_ms / 1000.0) at time zone 'America/Belem', 'HH24:MI');
  v_expected_exit := to_char(
    (to_timestamp(v_s.checkin_at_ms / 1000.0) + make_interval(mins => v_duration_minutes)) at time zone 'America/Belem',
    'HH24:MI');

  v_notes := nullif(trim(both ' |' from
    coalesce(array_to_string(v_s.sensory_tags, ' | '), '') ||
    case when v_s.notes is not null and v_s.notes <> '' then ' | ' || v_s.notes else '' end), '');

  -- Via 1 — pulseira/etiqueta que fica com a criança (Gainscha GS-2208D).
  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_s.unit_id, 'WRISTBAND', jsonb_build_object(
    'wristbandCode', v_s.access_code,
    'childName', v_s.child_name_snapshot,
    'guardianName', coalesce(v_guardian.full_name, 'Responsável'),
    'phone', coalesce(v_guardian.phone_e164, ''),
    'planName', v_plan.name,
    'entryTime', v_entry_time,
    'notes', v_notes
  ));

  -- Via 2 — recibo de guarda que fica com os pais (térmica 80mm).
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
    'qrValue', v_s.access_code,
    'entryTime', v_entry_time,
    'expectedExitTime', v_expected_exit,
    'planName', v_plan.name,
    'careNotes', v_notes,
    'items', jsonb_build_array(jsonb_build_object(
      'description', v_plan.name, 'quantity', 1, 'amountCents', v_plan.value_cents)),
    'totalCents', v_plan.value_cents,
    'customerInfo', jsonb_build_object(
      'childName', v_s.child_name_snapshot,
      'childBirthDate', to_char(v_child.birth_date, 'DD/MM/YYYY'),
      'guardianName', coalesce(v_guardian.full_name, ''),
      'guardianCpf', v_guardian.cpf,
      'phone', coalesce(v_guardian.phone_e164, '')),
    'footerNote', v_terms
  ));
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 4. fa_checkin — código curto, cuidados inclusivos e impressão dupla
-- ---------------------------------------------------------------------
-- Mesmo corpo da versão anterior (migration 20260806000020) com três
-- mudanças, e os dois parâmetros novos no fim com DEFAULT para que a
-- versão atual do aplicativo continue chamando sem quebrar durante o
-- deploy:
--   a) gera access_code curto; wristband_code/ticket_code passam a
--      carregar o mesmo código (as duas vias são do mesmo bilhete);
--   b) grava notes/sensory_tags;
--   c) enfileira as duas impressões antes de devolver.
--
-- O DROP abaixo é obrigatório, não higiene. `create or replace function`
-- não altera a lista de argumentos: com dois parâmetros a mais, o Postgres
-- criaria uma SEGUNDA fa_checkin em vez de substituir a antiga. As duas
-- conviveriam, e o PostgREST escolhe por nome de argumento — qualquer
-- terminal com a versão anterior do aplicativo continuaria caindo na
-- função velha, gerando entrada sem código curto e, pior, sem imprimir
-- pulseira nem recibo de guarda. É exatamente o tipo de falha que ninguém
-- percebe até a criança precisar sair.
drop function if exists fa_checkin(text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid);

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
  p_sensory_tags text[] default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_unit record;
  v_plan record;
  v_closing_time text;
  v_remaining integer;
  v_guardian_id uuid;
  v_child_id uuid;
  v_coupon record;
  v_coupon_id uuid := null;
  v_coupon_discount_cents integer := 0;
  v_session_id uuid := gen_random_uuid();
  v_access_code text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_visits_after integer;
  v_rule record;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then raise exception 'UNIDADE_INVALIDA'; end if;

  select * into v_plan from fa_kiosk_plans where id = p_plan_id and activity = p_activity;
  if not found then raise exception 'PLANO_INVALIDO'; end if;

  select value into v_closing_time from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'closing_time';
  if v_closing_time is not null then
    v_remaining := fa_kiosk_minutes_until_closing(v_now_ms, v_closing_time);
    if v_remaining is not null and fa_kiosk_plan_duration_minutes(v_plan.duration_value, v_plan.duration_unit) > v_remaining then
      raise exception 'FORA_DO_HORARIO: %', case when v_remaining > 0
        then format('Este plano não cabe até o fechamento (faltam %s min)', v_remaining)
        else 'O shopping já está fechando — não é possível iniciar novos planos' end;
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

  v_child_id := nullif(p_child->>'id', '')::uuid;
  if v_child_id is null then
    insert into fa_kiosk_children (full_name, birth_date, inclusive_eligible, inclusive_proof_type)
      values (p_child->>'fullName', (p_child->>'birthDate')::date,
              coalesce((p_child->>'inclusiveEligible')::boolean, false), p_child->>'inclusiveProofType')
      returning id into v_child_id;
  end if;

  -- is_authorized_pickup existe desde a migration 02 e nunca foi lido por
  -- ninguém. Passa a ser o dado que a saída manual confere (bloco 6).
  insert into fa_kiosk_child_guardians (child_id, guardian_id, is_authorized_pickup)
    values (v_child_id, v_guardian_id, true)
    on conflict (child_id, guardian_id) do nothing;

  if p_coupon_code is not null then
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

  insert into fa_kiosk_sessions (
    id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
    access_code, wristband_code, ticket_code, notes, sensory_tags,
    checkin_at, checkin_at_ms, checkin_by_employee_id,
    coupon_id, coupon_discount_cents, free_from_loyalty, business_date
  ) values (
    v_session_id, p_unit_id, p_activity, p_asset_id, p_plan_id, v_child_id, p_child->>'fullName', v_guardian_id,
    v_access_code, v_access_code, v_access_code, nullif(trim(coalesce(p_notes, '')), ''), p_sensory_tags,
    to_timestamp(v_now_ms / 1000.0), v_now_ms, p_employee_id,
    v_coupon_id, v_coupon_discount_cents, false, fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour)
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

  -- Impressão simultânea das duas vias. Dentro da transação de propósito:
  -- se qualquer coisa acima falhar, nenhuma via é enfileirada.
  perform fa_kiosk_enqueue_entry_prints(v_session_id);

  v_cached := jsonb_build_object(
    'sessionId', v_session_id, 'childId', v_child_id, 'guardianId', v_guardian_id,
    'accessCode', v_access_code,
    'wristbandCode', v_access_code, 'ticketCode', v_access_code,
    'frequencyBadge', fa_kiosk_visit_tier(v_child_id, v_now_ms)
  );
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkin', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

-- Reimpressão avulsa (etiqueta rasgou, papel acabou, impressora estava
-- offline): reenfileira as duas vias da MESMA sessão, sem tocar em nada
-- financeiro e sem gerar um código novo.
create or replace function fa_reimprimir_entrada(p_session_id uuid, p_employee_id uuid default null)
returns jsonb as $$
declare v_s record;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then raise exception 'SESSAO_NAO_ENCONTRADA'; end if;
  if v_s.access_code is null then
    update fa_kiosk_sessions set access_code = fa_kiosk_new_access_code() where id = p_session_id;
    select * into v_s from fa_kiosk_sessions where id = p_session_id;
  end if;
  perform fa_kiosk_enqueue_entry_prints(p_session_id);
  perform fa_kiosk_log_session_event(p_session_id, 'REIMPRESSAO_ENTRADA', p_employee_id, null);
  return jsonb_build_object('accessCode', v_s.access_code);
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 5. Saída padrão — resolver o que a câmera leu
-- ---------------------------------------------------------------------
-- Devolve SEMPRE um objeto com `reason`, nunca levanta exceção para código
-- errado: quem chama é uma tela de celular apontada para um QR, onde
-- "código não reconhecido" é ocorrência normal (leu a etiqueta de outra
-- coisa, leu tremido, leu a pulseira de ontem) e não um erro de sistema.
--
-- Não devolve preço: o valor a cobrar continua sendo calculado pelo mesmo
-- motor de preço que o Painel já usa, para não existirem duas tabelas de
-- preço divergentes no sistema.
create or replace function fa_resolve_access_code(
  p_unit_id uuid,
  p_code text,
  p_employee_id uuid default null
) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_guardian record;
begin
  if v_code = '' then
    return jsonb_build_object('reason', 'CODIGO_INVALIDO');
  end if;

  if fa_kiosk_verify_access_code(v_code) then
    select * into v_s from fa_kiosk_sessions where access_code = v_code;
  else
    -- Pulseiras impressas antes desta migração carregam o payload antigo
    -- "FA1|W|<uuid>|<hmac>", com o hexadecimal em minúsculas — por isso a
    -- comparação é com o texto cru, sem upper().
    select * into v_s from fa_kiosk_sessions
      where wristband_code = trim(p_code) or ticket_code = trim(p_code);
    if not found then
      return jsonb_build_object('reason', 'CODIGO_INVALIDO');
    end if;
  end if;

  if not found then
    return jsonb_build_object('reason', 'NAO_ENCONTRADO', 'code', v_code);
  end if;

  if v_s.unit_id <> p_unit_id then
    return jsonb_build_object('reason', 'OUTRA_UNIDADE', 'code', v_code);
  end if;

  if v_s.status = 'FINALIZADA' then
    return jsonb_build_object(
      'reason', 'JA_FINALIZADA', 'code', v_code,
      'childName', v_s.child_name_snapshot,
      'checkoutAtMs', v_s.checkout_at_ms);
  end if;

  select * into v_guardian from fa_kiosk_guardians where id = v_s.guardian_id;

  -- Registra a leitura mesmo antes da cobrança: se a criança saiu e o
  -- pagamento travou, o histórico mostra que a pulseira foi bipada aqui.
  perform fa_kiosk_log_session_event(v_s.id, 'SAIDA_QR_ESCANEADA', p_employee_id,
    jsonb_build_object('code', v_code));

  return jsonb_build_object(
    'reason', case when v_s.paused_at_ms is not null then 'PAUSADA' else 'OK' end,
    'code', v_code,
    'sessionId', v_s.id,
    'childName', v_s.child_name_snapshot,
    'guardianName', coalesce(v_guardian.full_name, ''),
    'guardianPhone', coalesce(v_guardian.phone_e164, ''),
    'checkinAtMs', v_s.checkin_at_ms,
    'notes', v_s.notes,
    'sensoryTags', to_jsonb(coalesce(v_s.sensory_tags, array[]::text[]))
  );
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 6. Saída de contingência — liberação por documento do responsável
-- ---------------------------------------------------------------------
-- Recibo perdido ou etiqueta danificada: o operador acha a criança pelo
-- card no Painel e libera conferindo o documento de quem veio buscar,
-- sem câmera e sem QR. O que este RPC garante é que essa liberação nunca
-- seja anônima — grava quem autorizou, contra qual documento, e se quem
-- retirou é um responsável cadastrado da criança ou um terceiro.
--
-- Devolve a lista de responsáveis autorizados para o operador conferir na
-- tela contra o documento em mãos.
-- O agregado vai numa subconsulta em vez de um `group by` no corpo: com o
-- join no nível de fora, uma criança sem nenhum responsável marcado para
-- retirada não produziria linha nenhuma e a função devolveria NULL em vez
-- de lista vazia — bem no caso em que a tela mais precisa abrir.
create or replace function fa_saida_responsaveis(p_session_id uuid) returns jsonb as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'guardianId', g.id,
             'fullName', g.full_name,
             'cpf', g.cpf,
             'phone', g.phone_e164,
             'isPrimary', g.id = s.guardian_id
           ) order by (g.id = s.guardian_id) desc, g.full_name)
    from fa_kiosk_child_guardians cg
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where cg.child_id = s.child_id and cg.is_authorized_pickup
  ), '[]'::jsonb)
  from fa_kiosk_sessions s
  where s.id = p_session_id
$$ language sql stable security definer;

create or replace function fa_saida_manual_authorize(
  p_session_id uuid,
  p_guardian_id uuid,
  p_document_kind text,
  p_document_note text,
  p_reason text,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_s record;
  v_authorized boolean := false;
  v_guardian_name text;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then raise exception 'SESSAO_NAO_ENCONTRADA'; end if;
  if v_s.status = 'FINALIZADA' then raise exception 'SESSAO_JA_FECHADA'; end if;

  if p_document_kind is null or trim(p_document_kind) = '' then
    raise exception 'DOCUMENTO_OBRIGATORIO';
  end if;
  if p_employee_id is null then raise exception 'COLABORADOR_OBRIGATORIO'; end if;

  if p_guardian_id is not null then
    select g.full_name, true into v_guardian_name, v_authorized
    from fa_kiosk_child_guardians cg
    join fa_kiosk_guardians g on g.id = cg.guardian_id
    where cg.child_id = v_s.child_id and cg.guardian_id = p_guardian_id and cg.is_authorized_pickup;
  end if;

  -- Retirada por quem não está no cadastro não é bloqueada aqui — no
  -- balcão real isso acontece (tia, avó, motorista) e travar a saída de
  -- uma criança por regra de software é pior que registrar a exceção.
  -- Mas fica marcada como exceção, com justificativa obrigatória.
  if not v_authorized and (p_reason is null or trim(p_reason) = '') then
    raise exception 'JUSTIFICATIVA_OBRIGATORIA';
  end if;

  perform fa_kiosk_log_session_event(p_session_id, 'SAIDA_MANUAL_AUTORIZADA', p_employee_id, jsonb_build_object(
    'documentKind', p_document_kind,
    'documentNote', nullif(trim(coalesce(p_document_note, '')), ''),
    'guardianId', p_guardian_id,
    'guardianName', v_guardian_name,
    'authorizedPickup', v_authorized,
    'reason', nullif(trim(coalesce(p_reason, '')), '')
  ));

  return jsonb_build_object('authorizedPickup', v_authorized, 'guardianName', v_guardian_name);
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 7. Correção: fa_checkout voltou a perder o código da venda
-- ---------------------------------------------------------------------
-- A migration 20260806000021 adicionou order_code ao pedido e ao retorno;
-- a 20260806000029 reescreveu fa_checkout inteira a partir da versão
-- anterior e desfez as duas coisas sem querer. O aplicativo continuou
-- lendo `orderCode` — e o comprovante de saída vinha impresso com
-- "Código: undefined" desde então. Restaurado sobre a versão vigente.
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

    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));
    v_free_from_loyalty := (v_index = 0 and array_length(p_redeem_reward_ids, 1) > 0);

    v_line_cents := (v_timing->>'liveTotalCents')::integer;
    v_total_cents := v_total_cents + v_line_cents;

    if coalesce(v_session.coupon_discount_cents, 0) > 0 then
      v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

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
    select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
    v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, coalesce(v_session.paused_ms_total, 0));
    insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
      values (v_order_id, 'SESSAO', 'SERVICO', format('%s — %s', v_session.child_name_snapshot, coalesce(v_plan.name, 'Plano')), 1,
        coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), v_session.id);
    if (v_timing->>'overMinutes')::integer > 0 then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
          (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
    end if;
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
$$ language plpgsql security definer;


-- ---------------------------------------------------------------------
-- 8. Permissões
-- ---------------------------------------------------------------------
-- A migration 20260807000003 revogou EXECUTE de public/anon em bloco e
-- concedeu só a authenticated. Funções criadas depois dela nascem
-- executáveis por PUBLIC de novo (padrão do PostgreSQL), então cada uma
-- precisa repetir o par revoke/grant.
do $$
declare
  r text;
  fns text[] := array[
    'fa_kiosk_code_alphabet()',
    'fa_kiosk_random_code(integer)',
    'fa_kiosk_code_checksum(text, integer)',
    'fa_kiosk_normalize_access_code(text)',
    'fa_kiosk_verify_access_code(text)',
    'fa_kiosk_new_access_code()',
    'fa_kiosk_enqueue_entry_prints(uuid)',
    'fa_reimprimir_entrada(uuid, uuid)',
    'fa_resolve_access_code(uuid, text, uuid)',
    'fa_saida_responsaveis(uuid)',
    'fa_saida_manual_authorize(uuid, uuid, text, text, text, uuid)',
    'fa_checkin(text, uuid, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text[])',
    'fa_checkout(text, uuid[], jsonb, uuid[], uuid)',
    'fa_kiosk_hmac8(text)'
  ];
begin
  foreach r in array fns loop
    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

-- Nada do maquinário do código fica ao alcance do aplicativo. Só as quatro
-- portas de operação (fa_checkin, fa_resolve_access_code, fa_saida_*,
-- fa_reimprimir_entrada) são chamáveis; gerar, verificar e enfileirar
-- impressão são passos internos delas.
--
-- Em particular o VERIFICADOR: exposto, ele responderia "este dígito
-- confere?" 32.768 vezes por segundo e permitiria montar um código bem
-- formado sem conhecer o segredo. Isso sozinho não abre a porta — o código
-- ainda precisaria coincidir com uma sessão real, o que é 1 em 1,1 trilhão
-- — mas não há motivo para entregar a primeira metade de graça.
do $$
declare
  r text;
  internos text[] := array[
    'fa_kiosk_code_alphabet()',
    'fa_kiosk_random_code(integer)',
    'fa_kiosk_code_checksum(text, integer)',
    'fa_kiosk_normalize_access_code(text)',
    'fa_kiosk_verify_access_code(text)',
    'fa_kiosk_new_access_code()',
    'fa_kiosk_enqueue_entry_prints(uuid)'
  ];
begin
  foreach r in array internos loop
    execute format('revoke execute on function %s from authenticated', r);
  end loop;
end $$;

comment on column fa_kiosk_sessions.access_code is
  'Código curto (11 caracteres Crockford Base32: 8 aleatórios + 3 de verificação HMAC) impresso na pulseira e no recibo de guarda. Cabe num QR versão 1 (21x21 módulos).';
