-- =====================================================================
-- Cortesia de aniversário: 30 min grátis no Playground (CRM + balcão)
-- =====================================================================
-- Regra de negócio
--   * 7 dias antes do aniversário o CRM manda a mensagem (ANIVERSARIO) e, na
--     mesma transação do envio, emite UMA cortesia por criança e aniversário.
--   * Validade: do envio até o ÚLTIMO DIA DO MÊS DE ANIVERSÁRIO, de segunda a
--     sexta (fuso de Belém). Só Playground (o Circuito não aceita).
--   * No balcão a cortesia aparece sozinha como o card "Cortesia de
--     aniversário (30min)" (plano de R$ 0,00, 30 min). A operadora só dá o ok.
--     O que passar dos 30 min é cobrado como minuto adicional do plano de
--     30 min da unidade (mesmo mecanismo de excedente de qualquer plano).
--   * Elegibilidade: aceite de marketing, telefone, criança cadastrada há
--     60 dias ou mais.
--   * Grupo de controle: aniversário em dia terminado em 0 ou 5 NÃO recebe a
--     mensagem nem a cortesia, mas é registrado (cohort CONTROLE) para
--     comparar visitas e compras na mesma janela.
--
-- Como o card chega ao check-in sem reescrever fa_checkin
--   O plano da cortesia é um fa_kiosk_plans com birthday_courtesy = true e
--   active = false. Inativo, ele não aparece em nenhuma lista de planos
--   (Entrada, Painel, pré-check-in público, Gerencial). A Entrada o busca por
--   fa_kiosk_birthday_courtesy_offer() só quando a criança identificada tem
--   cortesia utilizável. fa_checkin não exige plano ativo.
--
-- A validação NÃO fica na tela. O trigger abaixo, no INSERT da sessão,
-- recusa o plano da cortesia se a criança não tiver cortesia utilizável
-- agora, recusa cupom junto (o cupom de 40% aplicado sozinho pela Entrada
-- descontaria também o minuto adicional) e consome a cortesia. Se o
-- check-in falhar depois, a transação inteira volta e a cortesia continua
-- disponível.
--
-- Fora do escopo desta migration (decisão de negócio): feriados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Funções puras de data (aniversário em 29/02 cai em 28/02 nos anos não
--    bissextos; make_date(ano, 2, 29) estourava e derrubava a função de
--    candidatos do CRM inteira).
-- ---------------------------------------------------------------------
create or replace function fa_birthday_belem_date(p_ms bigint) returns date
language sql stable as $$
  select (to_timestamp(p_ms / 1000.0) at time zone 'America/Belem')::date
$$;

create or replace function fa_birthday_in_year(p_birth date, p_year int) returns date
language sql immutable as $$
  select (make_date(p_year, extract(month from p_birth)::int, 1)
          + (least(
               extract(day from p_birth)::int,
               extract(day from (make_date(p_year, extract(month from p_birth)::int, 1) + interval '1 month' - interval '1 day'))::int
             ) - 1))::date
$$;

/** Próxima data de aniversário a partir de p_ref (inclusive). */
create or replace function fa_birthday_next(p_birth date, p_ref date) returns date
language sql immutable as $$
  select case
    when fa_birthday_in_year(p_birth, extract(year from p_ref)::int) >= p_ref
      then fa_birthday_in_year(p_birth, extract(year from p_ref)::int)
    else fa_birthday_in_year(p_birth, extract(year from p_ref)::int + 1)
  end
$$;

create or replace function fa_birthday_month_end(p_date date) returns date
language sql immutable as $$
  select (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date
$$;

/** Dia de nascimento terminado em 0 ou 5 = grupo de controle (sem mensagem). */
create or replace function fa_birthday_cohort(p_birth date) returns text
language sql immutable as $$
  select case when extract(day from p_birth)::int % 5 = 0 then 'CONTROLE' else 'TRATAMENTO' end
$$;

-- ---------------------------------------------------------------------
-- 2. Cortesias emitidas (e linhas do grupo de controle)
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_birthday_courtesies (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references fa_kiosk_children (id),
  guardian_id uuid references fa_kiosk_guardians (id),
  birthday_date date not null,
  cohort text not null check (cohort in ('TRATAMENTO', 'CONTROLE')),
  status text not null check (status in ('EMITIDA', 'USADA', 'CONTROLE')),
  valid_from_ms bigint,
  valid_until_date date not null,
  used_session_id uuid,
  used_unit_id uuid references fa_kiosk_units (id),
  used_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (child_id, birthday_date),
  check ((cohort = 'CONTROLE') = (status = 'CONTROLE')),
  check (status <> 'USADA' or (used_session_id is not null and used_at_ms is not null))
);

create index if not exists idx_fa_birthday_courtesies_window
  on fa_kiosk_birthday_courtesies (birthday_date, cohort);

alter table fa_kiosk_birthday_courtesies enable row level security;
-- Escrita só pelas funções security definer abaixo. Leitura direta para quem
-- enxerga CRM ou relatórios; o relatório com nomes passa por
-- fa_birthday_courtesy_report().
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fa_kiosk_birthday_courtesies' and policyname = 'fa_birthday_courtesies_read') then
    create policy fa_birthday_courtesies_read on fa_kiosk_birthday_courtesies
      for select to authenticated using (fa_kiosk_can('crm.read') or fa_kiosk_can('relatorio.read'));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Plano da cortesia (inativo de propósito, ver cabeçalho)
-- ---------------------------------------------------------------------
alter table fa_kiosk_plans add column if not exists birthday_courtesy boolean not null default false;

-- Um por unidade, copiando o minuto adicional do plano avulso de 30 min do
-- Playground (o mais caro, se houver mais de um). Unidade sem plano de 30 min
-- fica sem cortesia até alguém criar o plano; a Entrada simplesmente não
-- mostra o card.
insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active, birthday_courtesy)
select distinct on (p.unit_id)
       p.unit_id, 'PLAYGROUND', 'Cortesia de aniversário (30min)', 0, 30, 'MINUTO',
       p.overage_cents_per_minute, '#F59E0B', false, true
  from fa_kiosk_plans p
 where p.activity = 'PLAYGROUND' and p.asset_kind is null and p.active
   and p.duration_unit = 'MINUTO' and p.duration_value = 30 and not p.birthday_courtesy
   and not exists (select 1 from fa_kiosk_plans b where b.unit_id = p.unit_id and b.birthday_courtesy)
 order by p.unit_id, p.value_cents desc, p.id;

-- ---------------------------------------------------------------------
-- 4. Cortesia utilizável agora (única fonte da regra: tela e trigger usam)
-- ---------------------------------------------------------------------
create or replace function fa_birthday_courtesy_usable(p_child_id uuid, p_now_ms bigint)
returns setof fa_kiosk_birthday_courtesies
language sql stable security definer set search_path = public, pg_temp as $$
  select c.*
    from fa_kiosk_birthday_courtesies c
   where c.child_id = p_child_id
     and c.cohort = 'TRATAMENTO' and c.status = 'EMITIDA'
     and p_now_ms >= c.valid_from_ms
     and fa_birthday_belem_date(p_now_ms) <= c.valid_until_date
     and extract(isodow from (to_timestamp(p_now_ms / 1000.0) at time zone 'America/Belem')) between 1 and 5
   order by c.valid_until_date
   limit 1
$$;

revoke execute on function fa_birthday_courtesy_usable(uuid, bigint) from public, anon, authenticated;

/** Card da Entrada: a cortesia da criança e o plano dela nesta unidade (0 linhas = não mostra). */
create or replace function fa_kiosk_birthday_courtesy_offer(p_child_id uuid, p_unit_id uuid)
returns table (courtesy_id uuid, plan_id uuid, valid_until date)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, p.id, c.valid_until_date
    from fa_birthday_courtesy_usable(p_child_id, (extract(epoch from now()) * 1000)::bigint) c
    join fa_kiosk_plans p on p.unit_id = p_unit_id and p.birthday_courtesy and p.activity = 'PLAYGROUND'
   limit 1
$$;

revoke all on function fa_kiosk_birthday_courtesy_offer(uuid, uuid) from public, anon;
grant execute on function fa_kiosk_birthday_courtesy_offer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Trava no servidor: INSERT da sessão
-- ---------------------------------------------------------------------
create or replace function fa_birthday_courtesy_on_checkin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_is_courtesy boolean;
  v_row fa_kiosk_birthday_courtesies;
begin
  if new.plan_id is null then return new; end if;
  select birthday_courtesy into v_is_courtesy from fa_kiosk_plans where id = new.plan_id;
  if not coalesce(v_is_courtesy, false) then return new; end if;

  if new.activity <> 'PLAYGROUND' or new.rental_kind is not null then
    raise exception 'CORTESIA_ANIVERSARIO_APENAS_PLAYGROUND: %', 'A cortesia de aniversário só vale no Playground';
  end if;
  if new.coupon_id is not null then
    raise exception 'CORTESIA_ANIVERSARIO_SEM_CUPOM: %', 'A cortesia de aniversário não aceita cupom';
  end if;

  select c.* into v_row
    from fa_kiosk_birthday_courtesies c
   where c.child_id = new.child_id
     and c.cohort = 'TRATAMENTO' and c.status = 'EMITIDA'
     and new.checkin_at_ms >= c.valid_from_ms
     and fa_birthday_belem_date(new.checkin_at_ms) <= c.valid_until_date
     and extract(isodow from (to_timestamp(new.checkin_at_ms / 1000.0) at time zone 'America/Belem')) between 1 and 5
   order by c.valid_until_date
   limit 1
   for update;
  if not found then
    raise exception 'CORTESIA_ANIVERSARIO_INDISPONIVEL: %',
      'Esta criança não tem cortesia de aniversário válida hoje (vale de segunda a sexta, até o fim do mês de aniversário)';
  end if;

  update fa_kiosk_birthday_courtesies
     set status = 'USADA', used_session_id = new.id, used_unit_id = new.unit_id, used_at_ms = new.checkin_at_ms
   where id = v_row.id;
  return new;
end;
$$;

revoke execute on function fa_birthday_courtesy_on_checkin() from public, anon, authenticated;

create or replace trigger trg_fa_birthday_courtesy_checkin
  after insert on fa_kiosk_sessions
  for each row execute function fa_birthday_courtesy_on_checkin();

-- Trocar o plano de uma sessão já aberta PARA o da cortesia contornaria o
-- trigger acima (ele só olha o INSERT).
create or replace function fa_birthday_courtesy_block_plan_swap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.plan_id is distinct from old.plan_id and new.plan_id is not null
     and exists (select 1 from fa_kiosk_plans where id = new.plan_id and birthday_courtesy) then
    raise exception 'CORTESIA_ANIVERSARIO_SO_NO_CHECKIN: %', 'A cortesia de aniversário só pode ser escolhida na entrada';
  end if;
  return new;
end;
$$;

revoke execute on function fa_birthday_courtesy_block_plan_swap() from public, anon, authenticated;

create or replace trigger trg_fa_birthday_courtesy_plan_swap
  before update of plan_id on fa_kiosk_sessions
  for each row execute function fa_birthday_courtesy_block_plan_swap();

-- ---------------------------------------------------------------------
-- 6. CRM: emissão, estorno e grupo de controle (só service_role)
-- ---------------------------------------------------------------------
/** Chamada pelo crm-lifecycle-dispatch ANTES de mandar a mensagem. */
create or replace function fa_crm_birthday_issue(p_child_id uuid, p_guardian_id uuid, p_birthday date, p_now_ms bigint)
returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with ins as (
    insert into fa_kiosk_birthday_courtesies
      (child_id, guardian_id, birthday_date, cohort, status, valid_from_ms, valid_until_date)
    values (p_child_id, p_guardian_id, p_birthday, 'TRATAMENTO', 'EMITIDA', p_now_ms, fa_birthday_month_end(p_birthday))
    on conflict (child_id, birthday_date) do nothing
    returning 1
  )
  select exists (select 1 from ins)
$$;

/** Envio falhou: a família não recebeu a mensagem, então não fica com cortesia. */
create or replace function fa_crm_birthday_void(p_child_id uuid, p_birthday date)
returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from fa_kiosk_birthday_courtesies
   where child_id = p_child_id and birthday_date = p_birthday
     and status = 'EMITIDA' and used_session_id is null
$$;

/** Registra o grupo de controle com a MESMA elegibilidade de quem recebe a mensagem. */
create or replace function fa_crm_birthday_register_control(p_now_ms bigint)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := fa_birthday_belem_date(p_now_ms);
  v_count integer;
begin
  insert into fa_kiosk_birthday_courtesies (child_id, guardian_id, birthday_date, cohort, status, valid_until_date)
  select c.id, cg.guardian_id, nb.d, 'CONTROLE', 'CONTROLE', fa_birthday_month_end(nb.d)
    from fa_kiosk_children c
    cross join lateral (select fa_birthday_next(c.birth_date, v_today) as d) nb
    join lateral (select guardian_id from fa_kiosk_child_guardians where child_id = c.id limit 1) cg on true
    join fa_kiosk_guardians g on g.id = cg.guardian_id
   where c.birth_date is not null
     and fa_birthday_cohort(c.birth_date) = 'CONTROLE'
     and nb.d between v_today and v_today + 7
     and c.created_at <= to_timestamp(p_now_ms / 1000.0) - interval '60 days'
     and g.marketing_consent_at_ms is not null and g.phone_e164 is not null
  on conflict (child_id, birthday_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function fa_crm_birthday_issue(uuid, uuid, date, bigint) from public, anon, authenticated;
revoke execute on function fa_crm_birthday_void(uuid, date) from public, anon, authenticated;
revoke execute on function fa_crm_birthday_register_control(bigint) from public, anon, authenticated;
grant execute on function fa_crm_birthday_issue(uuid, uuid, date, bigint) to service_role;
grant execute on function fa_crm_birthday_void(uuid, date) to service_role;
grant execute on function fa_crm_birthday_register_control(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 7. Trava de frequência: a cortesia de aniversário é a única mensagem com
--    data marcada e vale dinheiro para a família. Ela ignora o intervalo de
--    7 dias entre mensagens de marketing (senão quem recebeu uma oferta na
--    semana anterior perderia a cortesia e o grupo tratado ficaria
--    enviesado), mas continua contando no teto de 3 por 30 dias.
--    Assinatura nova de 4 argumentos AO LADO da de 3 (que segue valendo para
--    os outros chamadores, como crm-whatsapp-webhook): só o
--    crm-lifecycle-dispatch passa o kind. Sem DROP, de propósito.
-- ---------------------------------------------------------------------
create or replace function fa_crm_can_send(p_contact_id uuid, p_category text, p_now_ms bigint, p_kind text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_category <> 'MARKETING' then true else (
    (
      coalesce(p_kind = 'ANIVERSARIO', false)
      or not exists (
        select 1 from fa_crm_automation_sends s
        where s.contact_id = p_contact_id and s.status = 'SENT' and s.sent_at_ms > p_now_ms - 7 * 86400000::bigint
      )
    )
    and (
      select count(*) from fa_crm_automation_sends s
      where s.contact_id = p_contact_id and s.status = 'SENT' and s.sent_at_ms > p_now_ms - 30 * 86400000::bigint
    ) < 3
  ) end
$$;

revoke execute on function fa_crm_can_send(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function fa_crm_can_send(uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- 8. Template antigo (2 variáveis, "algo especial") sai; o novo tem 3
--    (responsável, criança, data limite) e nasce de crm-templates-bootstrap.
-- ---------------------------------------------------------------------
update fa_crm_templates set active = false where purpose = 'ANIVERSARIO' and variable_count <> 3;

-- ---------------------------------------------------------------------
-- 9. Relatório: usou, minutos adicionais, comprou depois e, para comparar
--    com o grupo de controle, visitas e gasto na MESMA janela
--    (7 dias antes do aniversário até o fim do mês de aniversário).
-- ---------------------------------------------------------------------
create or replace function fa_birthday_courtesy_report(p_from date, p_to date)
returns table (
  courtesy_id uuid, child_id uuid, child_name text, guardian_name text,
  birthday_date date, cohort text, sent_at_ms bigint, valid_until_date date,
  used boolean, used_at_ms bigint, used_unit_id uuid, used_unit_name text,
  overage_minutes integer, overage_cents integer, bought_after boolean,
  visits_in_window integer, paid_cents_in_window integer
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_names boolean := fa_kiosk_can('crm.read');
begin
  if not (v_names or fa_kiosk_can('relatorio.read')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with base as (
    select c.*,
           floor(extract(epoch from ((c.birthday_date - 7)::timestamp at time zone 'America/Belem')) * 1000)::bigint as win_start_ms,
           floor(extract(epoch from ((c.valid_until_date + 1)::timestamp at time zone 'America/Belem')) * 1000)::bigint as win_end_ms
      from fa_kiosk_birthday_courtesies c
     where c.birthday_date between p_from and p_to
  )
  select b.id, b.child_id,
         case when v_names then ch.full_name end,
         case when v_names then g.full_name end,
         b.birthday_date, b.cohort, b.valid_from_ms, b.valid_until_date,
         b.status = 'USADA', b.used_at_ms, b.used_unit_id, u.name,
         coalesce((
           select sum((regexp_match(oi.description, '\((\d+) min\)'))[1]::int)
             from fa_kiosk_order_items oi
            where oi.session_id = b.used_session_id and oi.description like 'Excedente%'
         ), 0)::integer,
         coalesce((
           select sum(oi.total_cents) from fa_kiosk_order_items oi
            where oi.session_id = b.used_session_id and oi.description like 'Excedente%'
         ), 0)::integer,
         case when b.status = 'USADA' then (
           exists (
             select 1 from fa_kiosk_sessions s2 join fa_kiosk_orders o2 on o2.id = s2.order_id
              where s2.child_id = b.child_id and s2.checkin_at_ms > b.used_at_ms
                and s2.checkin_at_ms <= b.used_at_ms + 30 * 86400000::bigint
                and o2.status = 'PAGA' and o2.total_cents > 0
           ) or exists (
             select 1 from fa_kiosk_guardian_packages gp
              where gp.guardian_id = b.guardian_id and gp.purchased_at_ms > b.used_at_ms
                and gp.purchased_at_ms <= b.used_at_ms + 30 * 86400000::bigint
           )
         ) end,
         (select count(*) from fa_kiosk_visit_log v
           where v.child_id = b.child_id and v.at_ms >= b.win_start_ms and v.at_ms < b.win_end_ms)::integer,
         coalesce((
           select sum(o3.total_cents) from fa_kiosk_sessions s3 join fa_kiosk_orders o3 on o3.id = s3.order_id
            where s3.child_id = b.child_id and o3.status = 'PAGA'
              and s3.checkin_at_ms >= b.win_start_ms and s3.checkin_at_ms < b.win_end_ms
         ), 0)::integer
    from base b
    join fa_kiosk_children ch on ch.id = b.child_id
    left join fa_kiosk_guardians g on g.id = b.guardian_id
    left join fa_kiosk_units u on u.id = b.used_unit_id
   order by b.birthday_date, b.cohort;
end;
$$;

revoke all on function fa_birthday_courtesy_report(date, date) from public, anon;
grant execute on function fa_birthday_courtesy_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 10. fa_checkout: idêntico a 20261008140000_fa_free_stay_grace, exceto os
--     trechos marcados "cortesia de aniversário":
--       a) plano de cortesia não consome o saldo de pacote do responsável
--          (sem isto, quem tem pacote perderia minutos do pacote na
--          cortesia e o total do servidor divergiria da cotação da tela,
--          que não conhece esse consumo: SOMA_PAGAMENTOS_DIVERGENTE);
--       b) tolerância de 3 min devolve a cortesia.
--     O excedente da cortesia sai de fa_kiosk_session_timing como em
--     qualquer plano (valor 0 + minutos adicionais, com a tolerância de 1
--     min que já vale para todos os planos e pacotes).
--     Espelho no front: packages/domain quoteForSession (sem mudança: plano
--     de valor 0 com excedente já é o caso do banco de horas).
-- ---------------------------------------------------------------------
create index if not exists idx_fa_birthday_courtesies_session
  on fa_kiosk_birthday_courtesies (used_session_id) where used_session_id is not null;

create or replace function fa_checkout(
  p_idempotency_key text, p_session_ids uuid[], p_payments jsonb,
  p_redeem_reward_ids uuid[], p_employee_id uuid, p_closed_at_ms bigint default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_actual_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_now_ms bigint := least(coalesce(p_closed_at_ms, v_actual_now_ms), v_actual_now_ms);
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
  v_loyalty_used boolean := false;
  v_loyalty_session_id uuid;
  v_courtesy_free boolean;
  v_free_stay boolean;
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

    -- A recompensa zera a primeira sessão do pedido que não é aluguel de
    -- pelúcia (antes: sempre a de v_index = 0).
    v_free_from_loyalty := (not v_loyalty_used and v_session.rental_kind is null
                            and array_length(p_redeem_reward_ids, 1) > 0);
    if v_free_from_loyalty then
      v_loyalty_used := true;
      v_loyalty_session_id := v_session.id;
    end if;
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000)) / 60000.0)::integer);
    -- tolerância: entrou e saiu em até 3 min não cobra nem consome saldo.
    v_free_stay := greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) <= 180000;

    if v_free_stay then
      v_line_cents := case when v_session.uses_package then coalesce(v_session.package_price_cents, 0) else 0 end;
    elsif v_session.uses_hour_bank then
      v_covered_minutes := fa_kiosk_hour_bank_consume(v_session.child_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      v_line_cents := v_uncovered_minutes * coalesce(v_session.hour_bank_overage_cents_per_minute, 0);
    elsif v_session.uses_package then
      -- Débito do saldo (FIFO por vencimento, consome primeiro o que o
      -- responsável já tinha antes deste pacote novo). O preço cheio do
      -- pacote é cobrado agora, na compra — diferente do banco de horas,
      -- que já foi pago quando o crédito nasceu. Excedente cobra pela
      -- tarifa do PACOTE (com desconto, ex.: 1,50 ou 1,80/min), não pela
      -- de um Plano — o plan_id da sessão é nulo aqui. Tolerância de 1
      -- minuto após esgotar o saldo, igual ao Plano (ver
      -- fa_kiosk_session_timing acima).
      v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
      v_line_cents := coalesce(v_session.package_price_cents, 0)
        + v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0);
    elsif v_session.uses_child_credit then
      -- Saldo já foi pago na venda (fa_kiosk_sell_prepaid_credit) — a
      -- linha do saldo em si é R$ 0,00, só o excedente cobra. Piso de
      -- min_consumption_minutes: crédito de Plano avulso não fraciona
      -- abaixo de uma visita inteira (null = Pacote, fraciona livre).
      v_covered_minutes := fa_kiosk_child_credit_consume(
        v_session.child_id,
        greatest(v_elapsed_minutes, coalesce(v_session.child_credit_min_consumption_minutes, 0)),
        v_now_ms);
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
      v_line_cents := v_uncovered_minutes * coalesce(v_session.child_credit_overage_cents_per_minute, 0);
    elsif v_session.rental_kind is not null then
      -- Aluguel de pelúcia: plano + excedente, nunca toca o pacote.
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000));
      v_line_cents := (v_timing->>'liveTotalCents')::integer;
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000));
      -- cortesia de aniversário: nunca consome o saldo de pacote da família
      -- (os 30 min são de graça; o excedente sai pela tarifa do plano).
      if coalesce(v_plan.birthday_courtesy, false) then
        v_covered_minutes := 0;
      else
        v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
      end if;
      v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));

      if v_covered_minutes > 0 then
        -- Plano pago com saldo de pacote do responsável: mesma tolerância
        -- de 1 minuto do Plano puro, aplicada aqui porque este ramo não
        -- passa por fa_kiosk_session_timing.
        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
        v_line_cents := v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0);
      else
        v_line_cents := (v_timing->>'liveTotalCents')::integer;
        -- Cortesia de fidelidade: até N min de permanência, o plano sai de
        -- graça; passou disso, o relógio já andou N min a menos (acima) e o
        -- plano é cobrado normalmente.
        if coalesce(v_session.loyalty_courtesy_minutes, 0) > 0
           and greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0))
               <= v_session.loyalty_courtesy_minutes * 60000 then
          v_line_cents := 0;
        end if;
      end if;
    end if;
    v_total_cents := v_total_cents + v_line_cents;

    v_applied_discount := 0;
    -- Pelúcia nunca tem desconto: o check-in já recusa cupom, e esta guarda
    -- garante que nenhum valor gravado na sessão abata o aluguel.
    if coalesce(v_session.coupon_discount_cents, 0) > 0 and v_session.rental_kind is null then
      if v_session.coupon_kind = 'DESCONTO_PCT' and v_session.activity = 'PLAYGROUND' then
        -- Recalcula sobre o valor real da linha (já com excedente), não
        -- sobre o valor fixo gravado no check-in — é o que garante que o
        -- minuto adicional também recebe o mesmo percentual de desconto.
        v_applied_discount := least(v_line_cents, round(v_line_cents * coalesce(v_session.coupon_pct, 0) / 100.0)::integer);
      else
        v_applied_discount := least(v_session.coupon_discount_cents, v_line_cents);
      end if;
      v_line_cents := v_line_cents - v_applied_discount;
      v_total_cents := v_total_cents - v_applied_discount;
    end if;
    if v_free_from_loyalty then
      v_total_cents := v_total_cents - v_line_cents;
    end if;

    select coalesce(sum(quantity * unit_price_cents), 0) into v_extra_cents
      from fa_kiosk_session_extra_items where session_id = v_session.id and order_id is null;
    v_total_cents := v_total_cents + v_extra_cents;

    update fa_kiosk_sessions set status = 'AGUARDANDO_PAGAMENTO', coupon_discount_cents = v_applied_discount where id = v_session.id;
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
    v_courtesy_free := coalesce(v_session.loyalty_courtesy_minutes, 0) > 0
      and greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0))
          <= v_session.loyalty_courtesy_minutes * 60000;
    v_free_stay := greatest(0, v_now_ms - v_session.checkin_at_ms - coalesce(v_session.paused_ms_total, 0)) <= 180000;
    if coalesce(v_session.loyalty_courtesy_minutes, 0) > 0 then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('Cortesia de fidelidade — %s min grátis', v_session.loyalty_courtesy_minutes), 1, 0, 0, 0, v_session.id);
    end if;
    v_elapsed_minutes := greatest(1, ceil(
      greatest(0, v_now_ms - v_session.checkin_at_ms - (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000)) / 60000.0)::integer);

    if v_free_stay then
      -- tolerância: linha única, sem consumo de saldo e sem banco de horas.
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      -- cortesia de aniversário: entrou e saiu em até 3 min não gasta a
      -- cortesia da família (foi o balcão escolhendo errado ou desistindo).
      if coalesce(v_plan.birthday_courtesy, false) then
        update fa_kiosk_birthday_courtesies
           set status = 'EMITIDA', used_session_id = null, used_unit_id = null, used_at_ms = null
         where used_session_id = v_session.id and status = 'USADA';
      end if;
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s', v_session.child_name_snapshot,
                 case when v_session.uses_package then coalesce(v_session.package_name_snapshot, 'Pacote')
                      else coalesce(v_plan.name, 'Plano') end), 1,
          case when v_session.uses_package then coalesce(v_session.package_price_cents, 0) else 0 end,
          case when v_session.uses_package then coalesce(v_session.package_price_cents, 0) else coalesce(v_plan.value_cents, 0) end,
          case when v_session.uses_package then coalesce(v_session.package_price_cents, 0) else 0 end, v_session.id);
    elsif v_session.uses_hour_bank then
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
    elsif v_session.uses_package then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s', v_session.child_name_snapshot, coalesce(v_session.package_name_snapshot, 'Pacote')), 1,
          coalesce(v_session.package_price_cents, 0), coalesce(v_session.package_price_cents, 0),
          coalesce(v_session.package_price_cents, 0), v_session.id);

      if v_covered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('%s min usados do saldo do pacote', v_covered_minutes), 1,
            0, 0, 0, v_session.id);
      end if;

      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
      if v_uncovered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Além do pacote (%s min)', v_uncovered_minutes), 1,
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.package_overage_cents_per_minute, 0), v_session.id);
      end if;
    elsif v_session.uses_child_credit then
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s min do saldo pré-pago', v_session.child_name_snapshot, v_covered_minutes), 1,
          0, 0, 0, v_session.id);

      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
      if v_uncovered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Além do saldo pré-pago (%s min)', v_uncovered_minutes), 1,
            v_uncovered_minutes * coalesce(v_session.child_credit_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.child_credit_overage_cents_per_minute, 0),
            v_uncovered_minutes * coalesce(v_session.child_credit_overage_cents_per_minute, 0), v_session.id);
      end if;
    elsif v_session.rental_kind is not null then
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000));
      insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
        values (v_order_id, 'SESSAO', 'SERVICO',
          format('%s — %s (%s)', v_session.child_name_snapshot,
                 coalesce((select name from fa_kiosk_assets where id = v_session.asset_id), 'Pelúcia'),
                 coalesce(v_plan.name, 'Pelúcia')), 1,
          coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), coalesce(v_plan.value_cents, 0), v_session.id);
      if (v_timing->>'overMinutes')::integer > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente pelúcia (%s min)', v_timing->>'overMinutes'), 1,
            (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
      end if;
    else
      select * into v_plan from fa_kiosk_plans where id = v_session.plan_id;
      v_timing := fa_kiosk_session_timing(v_plan, v_session.checkin_at_ms, v_now_ms, (coalesce(v_session.paused_ms_total, 0) + coalesce(v_session.loyalty_courtesy_minutes, 0) * 60000));

      if v_covered_minutes > 0 then
        insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
          values (v_order_id, 'SESSAO', 'SERVICO',
            format('%s — %s min do pacote', v_session.child_name_snapshot, v_covered_minutes), 1,
            0, coalesce(v_plan.value_cents, 0), 0, v_session.id);

        v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes - 1);
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
            case when v_courtesy_free then 0 else coalesce(v_plan.value_cents, 0) end, coalesce(v_plan.value_cents, 0),
            case when v_courtesy_free then 0 else coalesce(v_plan.value_cents, 0) end, v_session.id);
        if (v_timing->>'overMinutes')::integer > 0 then
          insert into fa_kiosk_order_items (order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, session_id)
            values (v_order_id, 'SESSAO', 'SERVICO', format('Excedente (%s min)', v_timing->>'overMinutes'), 1,
              (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, (v_timing->>'overCents')::integer, v_session.id);
        end if;

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

  -- Pedido só com pelúcia não resgata nada: a recompensa continua
  -- disponível para a próxima visita de verdade.
  if v_loyalty_used then
    foreach v_reward_id in array coalesce(p_redeem_reward_ids, array[]::uuid[]) loop
      update fa_kiosk_loyalty_rewards set redeemed_at_ms = v_now_ms, redeemed_session_id = v_loyalty_session_id
        where id = v_reward_id and redeemed_at_ms is null;
    end loop;
  end if;

  v_cached := jsonb_build_object('orderId', v_order_id, 'orderCode', v_order_code, 'totalCents', v_total_cents);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_checkout', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
