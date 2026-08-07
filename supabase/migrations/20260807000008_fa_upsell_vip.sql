-- =====================================================================
-- Motor de Cross-Selling por Ancoragem de Preço — FaçaAmigos
-- =====================================================================
-- O que este arquivo entrega, de ponta a ponta:
--
--   TABELA DE PREÇOS      fa_kiosk_packages — os pacotes/planos mensais
--                         que podem ser vendidos como upgrade. São uma
--                         coisa DIFERENTE de fa_kiosk_plans: plano é a
--                         permanência avulsa de hoje (15 min, 1 hora),
--                         pacote é o produto de recorrência (um saldo de
--                         horas com validade). Misturar os dois na mesma
--                         tabela faria a tela de Entrada oferecer "Pacote
--                         Família" como plano de permanência.
--
--   HISTÓRICO DE CONSUMO  fa_kiosk_guardian_packages (o que o responsável
--                         já comprou e quanto ainda tem de saldo) +
--                         fa_guardian_month_consumption() (quanto ele
--                         gastou em avulsos no mês corrente, derivado dos
--                         pedidos PAGOS — não é um contador paralelo que
--                         pode divergir do caixa).
--
--   MOTOR VIP             fa_kiosk_visits_in_window / fa_kiosk_is_vip —
--                         4 check-ins em 30 dias MÓVEIS (não "no mês"),
--                         ambos os números configuráveis por unidade.
--
--   OFERTA DINÂMICA       fa_upsell_offer() — acha o pacote de valor
--                         imediatamente superior ao gasto do mês, calcula
--                         a diferença e os dois custos/hora, e devolve o
--                         script já parametrizado para o operador ler.
--
--   LOG / COOLDOWN        fa_kiosk_upsell_offers — uma linha por
--                         oportunidade, com EXIBIDA → ACEITA/RECUSADA.
--                         A recusa grava cooldown_until_ms (15 dias) e é
--                         o próprio log que bloqueia a próxima exibição:
--                         não existe uma segunda tabela de "bloqueios"
--                         que possa discordar do histórico.
--
--   VENDA                 fa_upsell_vender_pacote() — cobra a DIFERENÇA,
--                         gera pedido + pagamento + saldo do pacote +
--                         recibo impresso, tudo numa transação só.
--
-- Nota sobre fa_kiosk_visit_tier (migration 10): aquele selo continua
-- existindo e não foi alterado — ele é o "3/8 visitas em 60 dias" que o
-- fa_checkin devolve. O selo VIP desta migração é outro critério (4 em
-- 30) e é o que a interface exibe. Deixá-los separados é de propósito:
-- mexer no tier antigo mudaria o retorno de fa_checkin, que já está em
-- produção, para resolver um problema que não é dele.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------

-- Dinheiro em português dentro do script de venda. O formato é escrito à
-- mão (e não via lc_numeric) porque o separador do to_char depende da
-- locale do servidor: com 'G'/'D' o mesmo código produz "1,234.50" num
-- banco e "1.234,50" noutro, e o script iria para o balcão com o número
-- no formato errado sem ninguém perceber.
create or replace function fa_kiosk_money_br(p_cents integer) returns text as $$
  select translate(to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,990.00'), ',.', '.,')
$$ language sql immutable;

-- Configuração numérica por unidade, com padrão. Os limiares do motor
-- (4 visitas, 30 dias, 15 dias de cooldown) são regra de negócio que o
-- dono vai querer calibrar depois de ver a conversão real — deixá-los
-- como literal no corpo da função obrigaria uma migração nova para
-- testar "e se fossem 5 visitas?".
create or replace function fa_kiosk_setting_int(p_unit_id uuid, p_key text, p_default integer)
returns integer as $$
  select coalesce(
    (select nullif(regexp_replace(value, '\D', '', 'g'), '')::integer
       from fa_kiosk_app_settings where unit_id = p_unit_id and key = p_key),
    p_default)
$$ language sql stable;

-- Primeiro instante do mês corrente, em milissegundos, no fuso da
-- unidade. "Mês corrente" para o responsável é o mês do calendário dele
-- (Belém), não o mês UTC — nos dois primeiros dias do mês a diferença
-- muda o valor que o operador vai LER EM VOZ ALTA para o cliente.
create or replace function fa_kiosk_month_start_ms(p_unit_id uuid, p_now_ms bigint)
returns bigint as $$
  select (extract(epoch from
    date_trunc('month', to_timestamp(p_now_ms / 1000.0) at time zone coalesce(u.timezone, 'America/Belem'))
      at time zone coalesce(u.timezone, 'America/Belem')
  ) * 1000)::bigint
  from fa_kiosk_units u where u.id = p_unit_id
$$ language sql stable;


-- ---------------------------------------------------------------------
-- 1. Tabela de preços dos pacotes
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_packages (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  activity text not null default 'PLAYGROUND' check (activity in ('PLAYGROUND', 'CARRINHO')),
  name text not null,
  -- Preço cheio do pacote. É contra ELE que o gasto do mês é ancorado
  -- (o cliente paga a diferença), por isso precisa ser o valor de tabela.
  price_cents integer not null check (price_cents > 0),
  -- Horas incluídas em minutos: um pacote de 10h vira 600. Guardar em
  -- minutos e não em horas evita o pacote de "1h30" virar 1.5 e depois
  -- 1 num arredondamento inteiro qualquer.
  included_minutes integer not null check (included_minutes > 0),
  validity_days integer not null default 30 check (validity_days > 0),
  -- Frase do benefício, lida literalmente no script de venda. É texto
  -- livre porque o benefício muda por campanha ("+1 lanche", "convidado
  -- grátis") e não cabe num enum.
  benefit_text text not null,
  color text not null default '#FF7A00',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_fa_kiosk_packages_unit
  on fa_kiosk_packages (unit_id, activity, price_cents) where active;

comment on table fa_kiosk_packages is
  'Pacotes/planos de recorrência vendáveis como upgrade. Não confundir com fa_kiosk_plans (permanência avulsa da visita de hoje).';


-- ---------------------------------------------------------------------
-- 2. Pacotes comprados — o saldo do responsável
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_guardian_packages (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  guardian_id uuid not null references fa_kiosk_guardians (id),
  child_id uuid references fa_kiosk_children (id),
  package_id uuid not null references fa_kiosk_packages (id),
  order_id uuid references fa_kiosk_orders (id),
  -- Snapshot: o pacote pode ter o preço reajustado amanhã, e o que foi
  -- vendido hoje não pode mudar retroativamente.
  package_name_snapshot text not null,
  price_cents integer not null,
  charged_cents integer not null,
  included_minutes integer not null,
  remaining_minutes integer not null,
  purchased_at_ms bigint not null,
  expires_at_ms bigint not null
);
create index if not exists idx_fa_kiosk_guardian_packages_guardian
  on fa_kiosk_guardian_packages (guardian_id, expires_at_ms);


-- ---------------------------------------------------------------------
-- 3. Log de oferta / conversão / recusa
-- ---------------------------------------------------------------------
-- Uma linha por OPORTUNIDADE, não por exibição: se o operador trocar de
-- tela e voltar, a mesma oportunidade do dia é reaproveitada (índice
-- único abaixo). Sem isso o funil mostraria 40 "ofertas" e 1 venda só
-- porque a tela foi aberta 40 vezes para a mesma família.
create table if not exists fa_kiosk_upsell_offers (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  guardian_id uuid not null references fa_kiosk_guardians (id),
  child_id uuid not null references fa_kiosk_children (id),
  package_id uuid not null references fa_kiosk_packages (id),
  session_id uuid references fa_kiosk_sessions (id),
  order_id uuid references fa_kiosk_orders (id),

  -- Os números exatos que foram ditos ao cliente. Congelados aqui porque
  -- o gasto do mês muda a cada visita: sem o snapshot, uma auditoria de
  -- "o que foi prometido" recalcularia outro valor.
  visits_window_days integer not null,
  visits_in_window integer not null,
  spend_cents integer not null,
  consumed_minutes integer not null,
  delta_cents integer not null,
  hourly_avulso_cents integer not null,
  hourly_plan_cents integer not null,
  script_text text not null,

  outcome text not null default 'EXIBIDA' check (outcome in ('EXIBIDA', 'ACEITA', 'RECUSADA')),
  offered_at_ms bigint not null,
  offered_by_employee_id uuid references fa_kiosk_employees (id),
  decided_at_ms bigint,
  decided_by_employee_id uuid references fa_kiosk_employees (id),
  -- Preenchido só na recusa. É a fonte única do bloqueio de 15 dias.
  cooldown_until_ms bigint,
  business_date date not null
);
create index if not exists idx_fa_kiosk_upsell_offers_guardian
  on fa_kiosk_upsell_offers (guardian_id, offered_at_ms desc);
create index if not exists idx_fa_kiosk_upsell_offers_cooldown
  on fa_kiosk_upsell_offers (guardian_id, cooldown_until_ms) where cooldown_until_ms is not null;
create unique index if not exists idx_fa_kiosk_upsell_offers_open
  on fa_kiosk_upsell_offers (guardian_id, child_id, business_date) where outcome = 'EXIBIDA';


-- ---------------------------------------------------------------------
-- 4. Motor VIP — 4 check-ins em 30 dias móveis
-- ---------------------------------------------------------------------
create or replace function fa_kiosk_visits_in_window(
  p_child_id uuid, p_now_ms bigint, p_window_days integer
) returns integer as $$
  select count(*)::integer from fa_kiosk_visit_log
   where child_id = p_child_id
     and at_ms is not null
     and at_ms > p_now_ms - (p_window_days::bigint * 86400000)
$$ language sql stable;

create or replace function fa_kiosk_is_vip(
  p_child_id uuid, p_unit_id uuid, p_now_ms bigint default null
) returns boolean as $$
declare
  v_now_ms bigint := coalesce(p_now_ms, (extract(epoch from now()) * 1000)::bigint);
begin
  return fa_kiosk_visits_in_window(p_child_id, v_now_ms,
           fa_kiosk_setting_int(p_unit_id, 'upsell_vip_window_days', 30))
         >= fa_kiosk_setting_int(p_unit_id, 'upsell_vip_visits', 4);
end;
$$ language plpgsql stable;

-- Selo para uma lista inteira de crianças numa consulta só — é o que o
-- Painel precisa: N cards na tela, não N chamadas de rede.
create or replace function fa_kiosk_vip_flags(p_unit_id uuid, p_child_ids uuid[])
returns table (child_id uuid, visits_in_window integer, is_vip boolean) as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_days integer := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_window_days', 30);
  v_min integer := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_visits', 4);
begin
  return query
    select c.id,
           fa_kiosk_visits_in_window(c.id, v_now_ms, v_days),
           fa_kiosk_visits_in_window(c.id, v_now_ms, v_days) >= v_min
      from unnest(coalesce(p_child_ids, array[]::uuid[])) as c(id);
end;
$$ language plpgsql stable security definer;


-- ---------------------------------------------------------------------
-- 5. Histórico de consumo do mês corrente, por responsável
-- ---------------------------------------------------------------------
-- Derivado dos pedidos PAGOS, nunca de um contador próprio: o número que
-- o operador vai falar ("o senhor investiu R$ 180 este mês") é o mesmo
-- que o relatório de caixa mostra. Um acumulador paralelo divergiria no
-- primeiro estorno.
--
-- Só entram itens de SESSÃO (a permanência avulsa). Consumo de loja não
-- é "investimento em brincar" e infla a âncora indevidamente.
create or replace function fa_guardian_month_consumption(
  p_unit_id uuid, p_guardian_id uuid, p_now_ms bigint default null
) returns jsonb as $$
declare
  v_now_ms bigint := coalesce(p_now_ms, (extract(epoch from now()) * 1000)::bigint);
  v_from_ms bigint := fa_kiosk_month_start_ms(p_unit_id, v_now_ms);
  v_spend integer := 0;
  v_minutes integer := 0;
  v_visits integer := 0;
begin
  select coalesce(sum(oi.total_cents), 0)::integer
    into v_spend
    from fa_kiosk_order_items oi
    join fa_kiosk_orders o on o.id = oi.order_id
    join fa_kiosk_sessions s on s.id = oi.session_id
   where s.guardian_id = p_guardian_id
     and o.unit_id = p_unit_id
     and o.status = 'PAGA'
     and coalesce(o.closed_at_ms, o.created_at_ms) >= v_from_ms
     and coalesce(o.closed_at_ms, o.created_at_ms) <= v_now_ms;

  -- Minutos efetivamente brincados no mês — o denominador do custo/hora
  -- avulso. Desconta pausa: cobrar o cliente por tempo pausado já não
  -- acontece no fechamento, e dividir por ele aqui inventaria um custo
  -- por hora menor do que o real, enfraquecendo a própria oferta.
  select coalesce(sum(greatest(1, ceil(
           (s.checkout_at_ms - s.checkin_at_ms - coalesce(s.paused_ms_total, 0)) / 60000.0))), 0)::integer,
         count(*)::integer
    into v_minutes, v_visits
    from fa_kiosk_sessions s
   where s.guardian_id = p_guardian_id
     and s.unit_id = p_unit_id
     and s.status = 'FINALIZADA'
     and s.checkout_at_ms is not null
     and s.checkin_at_ms >= v_from_ms
     and s.checkin_at_ms <= v_now_ms;

  return jsonb_build_object(
    'fromMs', v_from_ms,
    'spendCents', v_spend,
    'consumedMinutes', v_minutes,
    'sessions', v_visits);
end;
$$ language plpgsql stable security definer;


-- ---------------------------------------------------------------------
-- 6. A oferta — ancoragem, script parametrizado e cooldown
-- ---------------------------------------------------------------------
-- Devolve SEMPRE um objeto com `eligible`, nunca levanta exceção: quem
-- chama é a tela de Entrada com a família na frente do balcão, e "esta
-- criança não tem oferta hoje" é o caso comum, não um erro.
--
-- A ordem das guardas importa e é do mais barato para o mais caro:
-- cooldown e VIP antes de somar o consumo do mês.
create or replace function fa_upsell_offer(
  p_unit_id uuid,
  p_child_id uuid,
  p_guardian_id uuid default null,
  p_employee_id uuid default null
) returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_unit record;
  v_guardian_id uuid := p_guardian_id;
  v_guardian record;
  v_child record;
  v_window_days integer;
  v_min_visits integer;
  v_cooldown_days integer;
  v_visits integer;
  v_cooldown_until bigint;
  v_consumption jsonb;
  v_spend integer;
  v_minutes integer;
  v_hourly_avulso integer;
  v_pkg record;
  v_hourly_plan integer;
  v_delta integer;
  v_script text;
  v_offer_id uuid;
  v_business_date date;
begin
  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  if not found then return jsonb_build_object('eligible', false, 'reason', 'UNIDADE_INVALIDA'); end if;

  select * into v_child from fa_kiosk_children where id = p_child_id;
  if not found then return jsonb_build_object('eligible', false, 'reason', 'CRIANCA_INVALIDA'); end if;

  -- Responsável: o informado, ou o da última visita da criança, ou o
  -- único vínculo cadastrado. O cooldown é POR RESPONSÁVEL (é ele quem
  -- ouve e recusa a oferta), então errar aqui ofereceria de novo para
  -- quem acabou de dizer não.
  if v_guardian_id is null then
    select guardian_id into v_guardian_id from fa_kiosk_sessions
     where child_id = p_child_id order by checkin_at_ms desc nulls last limit 1;
  end if;
  if v_guardian_id is null then
    select guardian_id into v_guardian_id from fa_kiosk_child_guardians
     where child_id = p_child_id limit 1;
  end if;
  if v_guardian_id is null then
    return jsonb_build_object('eligible', false, 'reason', 'SEM_RESPONSAVEL');
  end if;
  select * into v_guardian from fa_kiosk_guardians where id = v_guardian_id;

  v_window_days   := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_window_days', 30);
  v_min_visits    := fa_kiosk_setting_int(p_unit_id, 'upsell_vip_visits', 4);
  v_cooldown_days := fa_kiosk_setting_int(p_unit_id, 'upsell_cooldown_days', 15);

  v_visits := fa_kiosk_visits_in_window(p_child_id, v_now_ms, v_window_days);

  -- Cooldown: uma recusa vale para o responsável inteiro, em qualquer
  -- criança dele. Quem disse não ontem para o filho mais velho não quer
  -- ouvir o mesmo script hoje pelo caçula.
  select max(cooldown_until_ms) into v_cooldown_until
    from fa_kiosk_upsell_offers
   where guardian_id = v_guardian_id and cooldown_until_ms is not null and cooldown_until_ms > v_now_ms;
  if v_cooldown_until is not null then
    return jsonb_build_object(
      'eligible', false, 'reason', 'COOLDOWN',
      'cooldownUntilMs', v_cooldown_until,
      'visitsInWindow', v_visits, 'isVip', v_visits >= v_min_visits);
  end if;

  if v_visits < v_min_visits then
    return jsonb_build_object(
      'eligible', false, 'reason', 'SEM_VIP',
      'visitsInWindow', v_visits, 'visitsRequired', v_min_visits, 'isVip', false);
  end if;

  -- Quem já tem saldo ativo não é alvo de upgrade — é alvo de usar o que
  -- comprou. Oferecer de novo aqui é o caminho mais rápido para o cliente
  -- achar que está sendo cobrado duas vezes.
  if exists (
    select 1 from fa_kiosk_guardian_packages
     where guardian_id = v_guardian_id and expires_at_ms > v_now_ms and remaining_minutes > 0
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'JA_TEM_PACOTE', 'isVip', true, 'visitsInWindow', v_visits);
  end if;

  v_consumption := fa_guardian_month_consumption(p_unit_id, v_guardian_id, v_now_ms);
  v_spend   := (v_consumption->>'spendCents')::integer;
  v_minutes := (v_consumption->>'consumedMinutes')::integer;

  if v_spend <= 0 then
    return jsonb_build_object('eligible', false, 'reason', 'SEM_GASTO_NO_MES', 'isVip', true, 'visitsInWindow', v_visits);
  end if;

  -- Custo/hora avulso real do cliente. Se por algum motivo não houver
  -- minutos apurados (sessão sem checkout no período), a divisão é
  -- impossível e a oferta não sai: um custo/hora inventado tornaria o
  -- script uma afirmação falsa dita a um cliente real.
  if v_minutes <= 0 then
    return jsonb_build_object('eligible', false, 'reason', 'SEM_HORAS_APURADAS', 'isVip', true, 'visitsInWindow', v_visits);
  end if;
  v_hourly_avulso := round(v_spend * 60.0 / v_minutes);

  -- O pacote de valor IMEDIATAMENTE SUPERIOR ao gasto do mês que também
  -- baixe o custo por hora. As duas condições juntas são a oferta: só a
  -- primeira venderia um pacote mais caro por hora ("pague mais, gaste
  -- mais"), e o script afirma o contrário.
  -- O filtro de atividade segue a mesma convenção do resto do sistema
  -- (QUIOSQUE opera CARRINHO, o resto opera PLAYGROUND). Sem ele, uma
  -- unidade que tivesse pacotes das duas atividades cadastrados poderia
  -- oferecer horas de circuito a quem só usa o playground.
  select * into v_pkg
    from fa_kiosk_packages p
   where p.unit_id = p_unit_id
     and p.activity = case when v_unit.kind = 'QUIOSQUE' then 'CARRINHO' else 'PLAYGROUND' end
     and p.active
     and p.price_cents > v_spend
     and round(p.price_cents * 60.0 / p.included_minutes) < v_hourly_avulso
   order by p.price_cents asc
   limit 1;

  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'SEM_PACOTE_SUPERIOR', 'isVip', true,
      'visitsInWindow', v_visits, 'spendCents', v_spend);
  end if;

  v_hourly_plan := round(v_pkg.price_cents * 60.0 / v_pkg.included_minutes);
  v_delta := v_pkg.price_cents - v_spend;

  v_script := format(
    'Notei que a criança já nos visitou %s vezes e o senhor(a) investiu R$ %s este mês. ' ||
    'Se o senhor(a) fizer o upgrade para o %s agora, por apenas mais R$ %s, ganha %s. ' ||
    'O seu custo por hora cai de R$ %s para R$ %s.',
    v_visits,
    fa_kiosk_money_br(v_spend),
    v_pkg.name,
    fa_kiosk_money_br(v_delta),
    v_pkg.benefit_text,
    fa_kiosk_money_br(v_hourly_avulso),
    fa_kiosk_money_br(v_hourly_plan));

  v_business_date := fa_kiosk_business_date(v_now_ms, v_unit.business_day_cutoff_hour);

  -- Registra (ou atualiza) a oportunidade do dia. O `on conflict` casa
  -- com o índice parcial de outcome='EXIBIDA': reabrir a tela não cria
  -- oferta nova, só reajusta os números caso o gasto do mês tenha mudado
  -- entre uma abertura e outra.
  insert into fa_kiosk_upsell_offers (
    unit_id, guardian_id, child_id, package_id,
    visits_window_days, visits_in_window, spend_cents, consumed_minutes,
    delta_cents, hourly_avulso_cents, hourly_plan_cents, script_text,
    outcome, offered_at_ms, offered_by_employee_id, business_date
  ) values (
    p_unit_id, v_guardian_id, p_child_id, v_pkg.id,
    v_window_days, v_visits, v_spend, v_minutes,
    v_delta, v_hourly_avulso, v_hourly_plan, v_script,
    'EXIBIDA', v_now_ms, p_employee_id, v_business_date
  )
  on conflict (guardian_id, child_id, business_date) where (outcome = 'EXIBIDA')
  do update set
    package_id = excluded.package_id,
    visits_in_window = excluded.visits_in_window,
    spend_cents = excluded.spend_cents,
    consumed_minutes = excluded.consumed_minutes,
    delta_cents = excluded.delta_cents,
    hourly_avulso_cents = excluded.hourly_avulso_cents,
    hourly_plan_cents = excluded.hourly_plan_cents,
    script_text = excluded.script_text,
    offered_at_ms = excluded.offered_at_ms
  returning id into v_offer_id;

  return jsonb_build_object(
    'eligible', true,
    'reason', 'OK',
    'isVip', true,
    'offerId', v_offer_id,
    'guardianId', v_guardian_id,
    'guardianName', coalesce(v_guardian.full_name, ''),
    'childId', p_child_id,
    'childName', v_child.full_name,
    'visitsInWindow', v_visits,
    'visitsWindowDays', v_window_days,
    'spendCents', v_spend,
    'consumedMinutes', v_minutes,
    'package', jsonb_build_object(
      'id', v_pkg.id,
      'name', v_pkg.name,
      'priceCents', v_pkg.price_cents,
      'includedMinutes', v_pkg.included_minutes,
      'validityDays', v_pkg.validity_days,
      'benefitText', v_pkg.benefit_text,
      'color', v_pkg.color),
    'deltaCents', v_delta,
    'hourlyAvulsoCents', v_hourly_avulso,
    'hourlyPlanCents', v_hourly_plan,
    'scriptText', v_script);
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 7. Recusa — aplica o cooldown de 15 dias
-- ---------------------------------------------------------------------
create or replace function fa_upsell_recusar(
  p_offer_id uuid,
  p_employee_id uuid default null
) returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_offer record;
  v_days integer;
  v_until bigint;
begin
  select * into v_offer from fa_kiosk_upsell_offers where id = p_offer_id for update;
  if not found then raise exception 'OFERTA_NAO_ENCONTRADA'; end if;
  if v_offer.outcome <> 'EXIBIDA' then
    return jsonb_build_object('outcome', v_offer.outcome, 'cooldownUntilMs', v_offer.cooldown_until_ms);
  end if;

  v_days := fa_kiosk_setting_int(v_offer.unit_id, 'upsell_cooldown_days', 15);
  v_until := v_now_ms + (v_days::bigint * 86400000);

  update fa_kiosk_upsell_offers
     set outcome = 'RECUSADA',
         decided_at_ms = v_now_ms,
         decided_by_employee_id = p_employee_id,
         cooldown_until_ms = v_until
   where id = p_offer_id;

  return jsonb_build_object('outcome', 'RECUSADA', 'cooldownUntilMs', v_until, 'cooldownDays', v_days);
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 8. Aceite — venda do pacote pela DIFERENÇA
-- ---------------------------------------------------------------------
-- Cobra `delta_cents`, e não o preço cheio: é exatamente o que foi dito
-- ao cliente ("por apenas mais R$ X"). O valor cheio do pacote fica
-- registrado como list_unit_price_cents na linha do pedido, para o
-- relatório saber que houve R$ (preço - delta) de crédito por ancoragem
-- e não um desconto manual não rastreado.
--
-- Idempotente pela mesma mecânica das outras RPCs transacionais: um
-- reenvio da fila offline não vende o pacote duas vezes.
create or replace function fa_upsell_vender_pacote(
  p_idempotency_key text,
  p_offer_id uuid,
  p_payments jsonb,
  p_employee_id uuid
) returns jsonb as $$
declare
  v_cached jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_offer record;
  v_pkg record;
  v_unit record;
  v_guardian record;
  v_shift record;
  v_order_id uuid := gen_random_uuid();
  v_order_code text;
  v_payments_total integer;
  v_payment jsonb;
  v_charge integer;
  v_expires bigint;
  v_gp_id uuid := gen_random_uuid();
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  if not fa_kiosk_can('venda.upsell') then raise exception 'SEM_PERMISSAO'; end if;

  select * into v_offer from fa_kiosk_upsell_offers where id = p_offer_id for update;
  if not found then raise exception 'OFERTA_NAO_ENCONTRADA'; end if;
  if v_offer.outcome = 'ACEITA' then raise exception 'OFERTA_JA_ACEITA'; end if;
  if v_offer.outcome = 'RECUSADA' then raise exception 'OFERTA_JA_RECUSADA'; end if;

  select * into v_pkg from fa_kiosk_packages where id = v_offer.package_id;
  if not found or not v_pkg.active then raise exception 'PACOTE_INDISPONIVEL'; end if;

  select * into v_unit from fa_kiosk_units where id = v_offer.unit_id;
  select * into v_guardian from fa_kiosk_guardians where id = v_offer.guardian_id;

  select * into v_shift from fa_kiosk_shifts where unit_id = v_offer.unit_id and status = 'ABERTO';
  if not found then raise exception 'SEM_TURNO_ABERTO'; end if;

  v_charge := v_offer.delta_cents;
  if v_charge <= 0 then raise exception 'VALOR_INVALIDO'; end if;

  select coalesce(sum((p->>'amountCents')::integer), 0) into v_payments_total
    from jsonb_array_elements(p_payments) p;
  if v_payments_total <> v_charge then
    raise exception 'SOMA_PAGAMENTOS_DIVERGENTE: esperado % recebido %', v_charge, v_payments_total;
  end if;

  v_order_code := fa_kiosk_next_order_code();

  insert into fa_kiosk_orders (id, unit_id, shift_id, kind, total_cents, status, business_date, order_code)
    values (v_order_id, v_offer.unit_id, v_shift.id, 'PDV', v_charge, 'ABERTA', v_shift.business_date, v_order_code);

  insert into fa_kiosk_order_items (
    order_id, item_type, item_nature, description, quantity,
    unit_price_cents, list_unit_price_cents, total_cents)
  values (
    v_order_id, 'SESSAO', 'SERVICO',
    format('Upgrade — %s (%s)', v_pkg.name, v_pkg.benefit_text), 1,
    v_charge, v_pkg.price_cents, v_charge);

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into fa_kiosk_payments (order_id, method, amount_cents, nsu, authorization_code, pix_txid)
      values (v_order_id, v_payment->>'method', (v_payment->>'amountCents')::integer,
        v_payment->>'nsu', v_payment->>'authorization', v_payment->>'pixTxid');
  end loop;

  update fa_kiosk_orders
     set status = 'PAGA', closed_by_employee_id = p_employee_id, closed_at_ms = v_now_ms
   where id = v_order_id;

  v_expires := v_now_ms + (v_pkg.validity_days::bigint * 86400000);

  insert into fa_kiosk_guardian_packages (
    id, unit_id, guardian_id, child_id, package_id, order_id,
    package_name_snapshot, price_cents, charged_cents,
    included_minutes, remaining_minutes, purchased_at_ms, expires_at_ms)
  values (
    v_gp_id, v_offer.unit_id, v_offer.guardian_id, v_offer.child_id, v_pkg.id, v_order_id,
    v_pkg.name, v_pkg.price_cents, v_charge,
    v_pkg.included_minutes, v_pkg.included_minutes, v_now_ms, v_expires);

  update fa_kiosk_upsell_offers
     set outcome = 'ACEITA', decided_at_ms = v_now_ms,
         decided_by_employee_id = p_employee_id, order_id = v_order_id
   where id = p_offer_id;

  -- Comprovante do upgrade. Na mesma transação, pelo mesmo motivo das
  -- duas vias do check-in: se a venda gravou, o cliente sai com o papel
  -- que prova quantas horas comprou e até quando valem.
  insert into fa_kiosk_print_jobs (unit_id, kind, payload_json)
  values (v_offer.unit_id, 'RECEIPT', jsonb_build_object(
    'title', 'Comprovante de Upgrade',
    'unitName', v_unit.name,
    'unitAddress', v_unit.address,
    'unitPhone', v_unit.phone,
    'unitCnpj', v_unit.cnpj,
    'orderCode', v_order_code,
    'dateTime', to_char(to_timestamp(v_now_ms / 1000.0) at time zone coalesce(v_unit.timezone, 'America/Belem'), 'DD/MM/YYYY HH24:MI:SS'),
    'items', jsonb_build_array(jsonb_build_object(
      'description', v_pkg.name, 'quantity', 1, 'amountCents', v_charge)),
    'totalCents', v_charge,
    'customerInfo', jsonb_build_object(
      'guardianName', coalesce(v_guardian.full_name, ''),
      'guardianCpf', v_guardian.cpf,
      'phone', coalesce(v_guardian.phone_e164, '')),
    'footerNote', format(
      '%s — %s h incluídas, válidas até %s. Já investido no mês: R$ %s. Diferença paga hoje: R$ %s.',
      v_pkg.name,
      trim(to_char(v_pkg.included_minutes / 60.0, 'FM999990.0')),
      to_char(to_timestamp(v_expires / 1000.0) at time zone coalesce(v_unit.timezone, 'America/Belem'), 'DD/MM/YYYY'),
      fa_kiosk_money_br(v_offer.spend_cents),
      fa_kiosk_money_br(v_charge))
  ));

  v_cached := jsonb_build_object(
    'orderId', v_order_id,
    'orderCode', v_order_code,
    'chargedCents', v_charge,
    'guardianPackageId', v_gp_id,
    'expiresAtMs', v_expires);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_upsell_vender_pacote', v_cached);
  return v_cached;
end;
$$ language plpgsql volatile security definer;


-- ---------------------------------------------------------------------
-- 9. Busca de criança com o selo VIP embutido
-- ---------------------------------------------------------------------
-- O selo precisa aparecer JÁ na lista de sugestões da busca, não só
-- depois de escolher a criança: é ali que o operador decide o tom do
-- atendimento. O drop é obrigatório — `create or replace` não altera o
-- tipo de retorno de uma função que retorna table.
drop function if exists fa_kiosk_search_children(text);

create or replace function fa_kiosk_search_children(p_query text, p_unit_id uuid default null)
returns table (
  id uuid, full_name text, birth_date date, phone_e164 text, guardian_name text, cpf text,
  visits_in_window integer, is_vip boolean
) as $$
  with base as (
    select c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name as guardian_name, g.cpf
      from fa_kiosk_children c
      left join fa_kiosk_child_guardians cg on cg.child_id = c.id
      left join fa_kiosk_guardians g on g.id = cg.guardian_id
     where c.full_name ilike '%' || p_query || '%' or g.phone_e164 ilike '%' || p_query || '%'
        or g.cpf ilike '%' || p_query || '%' or g.full_name ilike '%' || p_query || '%'
     group by c.id, c.full_name, c.birth_date, g.phone_e164, g.full_name, g.cpf
     order by c.full_name
     limit 10
  )
  select b.id, b.full_name, b.birth_date, b.phone_e164, b.guardian_name, b.cpf,
         fa_kiosk_visits_in_window(b.id, (extract(epoch from now()) * 1000)::bigint,
           fa_kiosk_setting_int(p_unit_id, 'upsell_vip_window_days', 30)),
         fa_kiosk_is_vip(b.id, p_unit_id)
    from base b
$$ language sql stable;


-- ---------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------
-- Leitura para qualquer colaborador autenticado (a tela de Entrada e o
-- Painel precisam), escrita da tabela de PREÇOS só para quem tem
-- config.write (mesma regra dos planos/produtos). As duas tabelas de
-- movimento não têm policy de escrita nenhuma: só as RPCs SECURITY
-- DEFINER acima gravam nelas, o que impede um cliente de forjar uma
-- "oferta aceita" ou de zerar o próprio cooldown com um UPDATE direto.
alter table fa_kiosk_packages enable row level security;
drop policy if exists fa_kiosk_packages_read on fa_kiosk_packages;
create policy fa_kiosk_packages_read on fa_kiosk_packages for select to authenticated using (true);
drop policy if exists fa_kiosk_packages_write_owner on fa_kiosk_packages;
create policy fa_kiosk_packages_write_owner on fa_kiosk_packages for all to authenticated
  using (fa_kiosk_can('config.write')) with check (fa_kiosk_can('config.write'));

alter table fa_kiosk_upsell_offers enable row level security;
drop policy if exists fa_kiosk_upsell_offers_read on fa_kiosk_upsell_offers;
create policy fa_kiosk_upsell_offers_read on fa_kiosk_upsell_offers for select to authenticated using (true);

alter table fa_kiosk_guardian_packages enable row level security;
drop policy if exists fa_kiosk_guardian_packages_read on fa_kiosk_guardian_packages;
create policy fa_kiosk_guardian_packages_read on fa_kiosk_guardian_packages for select to authenticated using (true);


-- ---------------------------------------------------------------------
-- 11. Capacidade e permissões de execução
-- ---------------------------------------------------------------------
-- Vender upgrade é ação de balcão: nasce no Operador. A herança de
-- fa_kiosk_can faz Líder e Owner receberem junto.
insert into fa_kiosk_role_capabilities (role, capability)
values ('OPERADOR', 'venda.upsell')
on conflict do nothing;

do $$
declare
  r text;
  fns text[] := array[
    'fa_kiosk_money_br(integer)',
    'fa_kiosk_setting_int(uuid, text, integer)',
    'fa_kiosk_month_start_ms(uuid, bigint)',
    'fa_kiosk_visits_in_window(uuid, bigint, integer)',
    'fa_kiosk_is_vip(uuid, uuid, bigint)',
    'fa_kiosk_vip_flags(uuid, uuid[])',
    'fa_guardian_month_consumption(uuid, uuid, bigint)',
    'fa_upsell_offer(uuid, uuid, uuid, uuid)',
    'fa_upsell_recusar(uuid, uuid)',
    'fa_upsell_vender_pacote(text, uuid, jsonb, uuid)',
    'fa_kiosk_search_children(text, uuid)'
  ];
begin
  foreach r in array fns loop
    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

-- Auxiliares internos saem do alcance do aplicativo: nada na UI precisa
-- chamá-los soltos, e expostos eles viram um oráculo de gasto por
-- responsável para qualquer sessão autenticada.
revoke execute on function fa_kiosk_month_start_ms(uuid, bigint) from authenticated;
revoke execute on function fa_guardian_month_consumption(uuid, uuid, bigint) from authenticated;



-- ---------------------------------------------------------------------
-- 12. Consumo do saldo no fechamento
-- ---------------------------------------------------------------------
-- Sem este bloco a feature estaria pela metade: o pacote seria vendido e
-- nunca honrado — a mesma família pagaria o upgrade e continuaria pagando
-- avulso a cada visita. É um defeito de cobrança contra um cliente real,
-- não um "nice to have" de fase 2.
--
-- Modelo: o pacote é um SALDO DE MINUTOS pré-pago. O tempo brincado sai
-- do saldo; o que passar do saldo é cobrado pela tarifa de excedente do
-- plano (o preço por minuto que o parque já pratica), e não pelo preço
-- cheio do plano — cobrar o plano inteiro por 5 minutos que estouraram o
-- saldo é exatamente a surpresa que faz o cliente desistir da renovação.

create or replace function fa_kiosk_package_consume(
  p_unit_id uuid, p_guardian_id uuid, p_minutes integer, p_now_ms bigint
) returns integer as $$
declare
  v_left integer := greatest(0, coalesce(p_minutes, 0));
  v_covered integer := 0;
  v_take integer;
  v_gp record;
begin
  if v_left = 0 or p_guardian_id is null then return 0; end if;

  -- Ordem por vencimento: gasta primeiro o saldo que expira antes, senão
  -- o cliente perde minutos que já pagou enquanto sobra saldo novo.
  for v_gp in
    select * from fa_kiosk_guardian_packages
     where guardian_id = p_guardian_id and unit_id = p_unit_id
       and expires_at_ms > p_now_ms and remaining_minutes > 0
     order by expires_at_ms asc
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_gp.remaining_minutes, v_left);
    update fa_kiosk_guardian_packages
       set remaining_minutes = remaining_minutes - v_take
     where id = v_gp.id;
    v_covered := v_covered + v_take;
    v_left := v_left - v_take;
  end loop;

  return v_covered;
end;
$$ language plpgsql volatile security definer;

-- Saldo total ainda válido de um responsável — só leitura, é o que o
-- Painel mostra no card para o operador não ser pego de surpresa por um
-- fechamento que cobra menos do que a tela vinha estimando.
create or replace function fa_kiosk_guardian_package_balance(p_unit_id uuid, p_guardian_ids uuid[])
returns table (guardian_id uuid, remaining_minutes integer, expires_at_ms bigint) as $$
  select gp.guardian_id, sum(gp.remaining_minutes)::integer, min(gp.expires_at_ms)
    from fa_kiosk_guardian_packages gp
   where gp.unit_id = p_unit_id
     and gp.guardian_id = any(coalesce(p_guardian_ids, array[]::uuid[]))
     and gp.expires_at_ms > (extract(epoch from now()) * 1000)::bigint
     and gp.remaining_minutes > 0
   group by gp.guardian_id
$$ language sql stable;

-- fa_checkout reescrita a partir da versão vigente (20260807000007) com
-- UMA adição: o abatimento do saldo. Para quem não tem pacote,
-- fa_kiosk_package_consume devolve 0 na primeira linha e o caminho de
-- código é idêntico ao de hoje — a regressão possível fica confinada a
-- quem comprou pacote.
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
  -- Minutos cobertos pelo pacote, por sessão. Calculado (e debitado) no
  -- laço de preço e reusado no laço que escreve os itens do pedido: o
  -- débito não pode acontecer duas vezes, e recalcular no segundo laço
  -- daria outro número porque o saldo já mudou.
  v_covered jsonb := '{}'::jsonb;
  v_covered_minutes integer;
  v_elapsed_minutes integer;
  v_uncovered_minutes integer;
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

    v_elapsed_minutes := ceil((v_timing->>'elapsedMs')::bigint / 60000.0);
    v_covered_minutes := fa_kiosk_package_consume(v_session.unit_id, v_session.guardian_id, v_elapsed_minutes, v_now_ms);
    v_covered := jsonb_set(v_covered, array[v_session.id::text], to_jsonb(v_covered_minutes));

    if v_covered_minutes > 0 then
      v_uncovered_minutes := greatest(0, v_elapsed_minutes - v_covered_minutes);
      v_line_cents := v_uncovered_minutes * coalesce(v_plan.overage_cents_per_minute, 0);
    else
      v_line_cents := (v_timing->>'liveTotalCents')::integer;
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
    v_covered_minutes := coalesce((v_covered->>v_session.id::text)::integer, 0);
    v_elapsed_minutes := ceil((v_timing->>'elapsedMs')::bigint / 60000.0);

    if v_covered_minutes > 0 then
      -- Linha de valor zero, mas explícita no cupom: o responsável precisa
      -- ver quantos minutos saíram do pacote que ele comprou. Um abatimento
      -- silencioso é indistinguível de um erro de cobrança.
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

do $$
declare
  r text;
  fns text[] := array[
    'fa_kiosk_package_consume(uuid, uuid, integer, bigint)',
    'fa_kiosk_guardian_package_balance(uuid, uuid[])',
    'fa_checkout(text, uuid[], jsonb, uuid[], uuid)'
  ];
begin
  foreach r in array fns loop
    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

-- Debitar saldo é passo interno do fechamento, nunca uma chamada solta:
-- exposto, qualquer sessão autenticada zeraria o pacote de um cliente.
revoke execute on function fa_kiosk_package_consume(uuid, uuid, integer, bigint) from authenticated;
