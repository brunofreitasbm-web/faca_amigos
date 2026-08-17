-- =====================================================================
-- Pacotes no Acesso Rápido (pré-cadastro pelo celular) — FaçaAmigos
-- =====================================================================
-- Pedido: o mesmo desconto automático (-40% público geral / -50% criança
-- neurodivergente) que a Entrada já aplica a Planos E Pacotes
-- (20260816000003_fa_checkin_pacotes.sql + 20260816050000_fa_checkin_
-- cupom_em_pacote.sql) precisa também aparecer no Acesso Rápido — mas lá
-- os Pacotes (ex.: DAY USE, PORTO SEGURO) nem apareciam como opção: o
-- formulário público só listava fa_kiosk_plans.
--
-- Muda aqui:
--   1) fa_kiosk_pre_checkins.plan_id vira opcional; ganha package_id
--      (opcional também) — exatamente 1 dos dois precisa estar presente,
--      mesmo par Plano/Pacote que fa_kiosk_sessions já tem desde
--      20260816000003 (uses_package/package_id).
--   2) fa_pre_checkin_form_options devolve também os Pacotes ativos da
--      unidade, no mesmo formato que Api.packages já usa na Entrada.
--   3) fa_pre_checkin_submit aceita p_package_id (default null) — exige
--      exatamente um dos dois (plano OU pacote), nunca os dois.
--   4) fa_pre_checkin_list devolve packageId/packageName junto com
--      planId/planName (LEFT JOIN em ambos, já que agora um dos dois pode
--      ser nulo) — é o que preenche o planId do formulário da Entrada
--      quando o operador confirma um pré-cadastro.
--
-- O desconto em si já não precisa de mudança nenhuma aqui: é só exibido
-- no Acesso Rápido (preço mostrado à família antes de chegar) e aplicado
-- de verdade depois, no fa_checkin de sempre — que já sabe descontar
-- Pacote desde a migração anterior.
-- =====================================================================

alter table fa_kiosk_pre_checkins
  alter column plan_id drop not null,
  add column if not exists package_id uuid references fa_kiosk_packages (id);

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'fa_kiosk_pre_checkins_plan_or_package') then
    alter table fa_kiosk_pre_checkins drop constraint fa_kiosk_pre_checkins_plan_or_package;
  end if;
  alter table fa_kiosk_pre_checkins add constraint fa_kiosk_pre_checkins_plan_or_package
    check ((plan_id is not null) <> (package_id is not null));
end $$;


-- ---------------------------------------------------------------------
-- 1) Opções do formulário público: planos + pacotes ativos da unidade.
-- ---------------------------------------------------------------------
create or replace function fa_pre_checkin_form_options(p_unit_id uuid) returns jsonb as $$
declare
  v_unit record;
  v_activity text;
  v_plans jsonb;
  v_packages jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pkg.id,
    'name', pkg.name,
    'priceCents', pkg.price_cents,
    'includedMinutes', pkg.included_minutes,
    'color', pkg.color
  ) order by pkg.price_cents), '[]'::jsonb)
  into v_packages
  from fa_kiosk_packages pkg
  where pkg.unit_id = p_unit_id and pkg.activity = v_activity and pkg.active;

  select value into v_terms from fa_kiosk_app_settings where unit_id = p_unit_id and key = 'terms_of_use';

  return jsonb_build_object(
    'unitName', v_unit.name,
    'activity', v_activity,
    'plans', v_plans,
    'packages', v_packages,
    'termsText', coalesce(v_terms, '')
  );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------
-- 2) Submit: aceita p_package_id (default null) como alternativa a
--    p_plan_id — parâmetro novo no fim preserva o grant existente.
-- ---------------------------------------------------------------------
-- DROP obrigatório: parâmetro novo muda a assinatura, e create or replace
-- sozinho criaria uma SEGUNDA fa_pre_checkin_submit em vez de substituir
-- (mesmo motivo documentado em fa_checkin, 20260816000003_fa_checkin_
-- pacotes.sql).
drop function if exists fa_pre_checkin_submit(uuid, text, uuid, jsonb, text, text, text, boolean);

create or replace function fa_pre_checkin_submit(
  p_unit_id uuid,
  p_activity text,
  p_plan_id uuid,
  p_children jsonb,
  p_guardian_name text,
  p_cpf text,
  p_phone_e164 text,
  p_terms_accepted boolean,
  p_package_id uuid default null
) returns jsonb as $$
declare
  v_id uuid;
  v_pin text;
  v_child jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_cpf_digits text;
begin
  if (p_plan_id is not null) = (p_package_id is not null) then
    raise exception 'PLANO_OU_PACOTE_OBRIGATORIO';
  end if;

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

  if p_package_id is not null then
    if not exists (
      select 1 from fa_kiosk_packages
      where id = p_package_id and unit_id = p_unit_id and activity = p_activity and active
    ) then raise exception 'PACOTE_INVALIDO'; end if;
  else
    if not exists (
      select 1 from fa_kiosk_plans
      where id = p_plan_id and unit_id = p_unit_id and activity = p_activity and active
    ) then raise exception 'PLANO_INVALIDO'; end if;
  end if;

  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  insert into fa_kiosk_pre_checkins (
    unit_id, activity, plan_id, package_id, children, guardian_name, cpf, phone_e164, terms_accepted_at_ms, pin
  ) values (
    p_unit_id, p_activity, p_plan_id, p_package_id, v_normalized, btrim(p_guardian_name),
    v_cpf_digits, p_phone_e164, (extract(epoch from now()) * 1000)::bigint, v_pin
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'pin', v_pin);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_submit(uuid, text, uuid, jsonb, text, text, text, boolean, uuid) from public, anon;
grant execute on function fa_pre_checkin_submit(uuid, text, uuid, jsonb, text, text, text, boolean, uuid) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3) Lista do balcão: planId/planName OU packageId/packageName, conforme
--    o que a família escolheu (LEFT JOIN nos dois — um dos dois é nulo).
-- ---------------------------------------------------------------------
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
    'packageId', pc.package_id,
    'packageName', pkg.name,
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
  left join fa_kiosk_plans p on p.id = pc.plan_id
  left join fa_kiosk_packages pkg on pkg.id = pc.package_id
  cross join lateral jsonb_array_elements(pc.children) with ordinality as child(value, idx)
  where pc.unit_id = p_unit_id
    and pc.status = 'PENDENTE'
    and not (pc.conversions ? (child.idx - 1)::text);

  return v_rows;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_pre_checkin_list(uuid) from public, anon;
grant execute on function fa_pre_checkin_list(uuid) to authenticated, service_role;
