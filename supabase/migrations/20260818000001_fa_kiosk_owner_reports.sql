-- =====================================================================
-- Rotinas de Notificação para o Owner (Web Push)
-- =====================================================================
-- Reaproveita o padrão de 20260810000001_fa_push_alertas.sql (fila em
-- tabela + pg_cron + edge function de envio), mas para um destinatário
-- diferente: não o responsável de uma sessão, e sim o(s) dispositivo(s)
-- do Owner (role ADMIN) da unidade, com 3 relatórios:
--   1. Abertura — no instante em que o caixa abre.
--   2. Acompanhamento — 17h e 20h, ticket médio/faturado/visitas do dia.
--   3. Fechamento — no instante em que o caixa fecha, no formato que o
--      Owner já usa manualmente hoje (fundo de caixa, envelope, valor
--      faturado por forma de pagamento).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Emoji da unidade — usado no cabeçalho do relatório de Fechamento
--    ("[emoji] Fechamento [Unidade]"). Não existia coluna própria; só
--    produtos/frota tinham emoji até aqui.
-- ---------------------------------------------------------------------
alter table fa_kiosk_units add column if not exists emoji text not null default '🏠';

-- ---------------------------------------------------------------------
-- 1. Inscrições de push do Owner (por colaborador + navegador, não por
--    sessão de criança — um Owner pode ter mais de um dispositivo).
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_owner_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references fa_kiosk_employees (id),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (employee_id, endpoint)
);

alter table fa_kiosk_owner_push_subscriptions enable row level security;
-- Sem policy: escrita só pelas RPCs abaixo (security definer), leitura só
-- pela RPC interna do service_role (fa_owner_push_claim_due).

-- ---------------------------------------------------------------------
-- 2. Fila de notificações — uma linha por (unidade, tipo de relatório,
--    dia). O unique index é o que impede duplicidade se o cron rodar
--    mais de uma vez na mesma janela de 17h/20h.
-- ---------------------------------------------------------------------
-- unit_id é opcional: Banco de Talentos não pertence a uma unidade (ver
-- seção 10), e a notificação ainda assim precisa ser enfileirada.
create table if not exists fa_kiosk_owner_notifications (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references fa_kiosk_units (id),
  report_type text not null check (report_type in (
    'ABERTURA', 'ACOMPANHAMENTO_17H', 'ACOMPANHAMENTO_20H', 'FECHAMENTO',
    'DIVERGENCIA_FECHAMENTO', 'RESUMO_SEMANAL', 'CANDIDATURA_TALENTOS',
    'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA'
  )),
  business_date date not null,
  title text not null,
  body text not null,
  due_at_ms bigint not null,
  sent_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  -- Dois regimes de deduplicação, cada relatório usa um só:
  --   recorrente por dia (Abertura/Acompanhamento/Fechamento/Resumo
  --   semanal) — dedupe_key fica null, a chave é (unidade, tipo, dia);
  --   por evento (divergência, candidatura, ocorrência, avaliação) —
  --   dedupe_key = 'entidade:<id>', vários no mesmo dia não podem colidir
  --   entre si, então business_date não pode ser a chave.
  dedupe_key text
);
create index if not exists idx_fa_owner_notifications_pending on fa_kiosk_owner_notifications (due_at_ms) where sent_at_ms is null;
create unique index if not exists idx_fa_owner_notifications_daily on fa_kiosk_owner_notifications (unit_id, report_type, business_date) where dedupe_key is null;
create unique index if not exists idx_fa_owner_notifications_event on fa_kiosk_owner_notifications (report_type, dedupe_key) where dedupe_key is not null;

alter table fa_kiosk_owner_notifications enable row level security;
-- Sem policy: só as funções security definer abaixo mexem nesta tabela.

-- ---------------------------------------------------------------------
-- 3. Capacidade nova — só o Owner (ADMIN) liga/desliga notificação no
--    próprio dispositivo. Não herda de GERENTE: relatório financeiro
--    consolidado da unidade é leitura de dono do negócio, diferente de
--    'relatorio.read' (que já é aberto ao Líder).
-- ---------------------------------------------------------------------
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'notificacoes.owner_push')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. RPCs de inscrição — mesmo padrão de fa_kiosk_close_payroll_run:
--    identidade vem de auth.uid() via fa_kiosk_current_employee_id(),
--    nunca de um parâmetro que o client poderia forjar.
-- ---------------------------------------------------------------------
create or replace function fa_owner_push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void as $$
declare
  v_employee_id uuid := fa_kiosk_current_employee_id();
begin
  if not fa_kiosk_can('notificacoes.owner_push') then
    raise exception 'sem permissão para ativar notificações do Owner' using errcode = '42501';
  end if;
  if v_employee_id is null then
    raise exception 'colaborador não identificado' using errcode = '42501';
  end if;

  insert into fa_kiosk_owner_push_subscriptions (employee_id, endpoint, p256dh, auth)
    values (v_employee_id, p_endpoint, p_p256dh, p_auth)
    on conflict (employee_id, endpoint) do update
      set p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$ language plpgsql volatile security definer;

revoke execute on function fa_owner_push_subscribe(text, text, text) from public, anon;
grant execute on function fa_owner_push_subscribe(text, text, text) to authenticated;

create or replace function fa_owner_push_unsubscribe(p_endpoint text) returns void as $$
declare
  v_employee_id uuid := fa_kiosk_current_employee_id();
begin
  if v_employee_id is null then
    raise exception 'colaborador não identificado' using errcode = '42501';
  end if;
  delete from fa_kiosk_owner_push_subscriptions where employee_id = v_employee_id and endpoint = p_endpoint;
end;
$$ language plpgsql volatile security definer;

revoke execute on function fa_owner_push_unsubscribe(text) from public, anon;
grant execute on function fa_owner_push_unsubscribe(text) to authenticated;

create or replace function fa_owner_push_is_subscribed(p_endpoint text) returns boolean as $$
  select exists (
    select 1 from fa_kiosk_owner_push_subscriptions
    where employee_id = fa_kiosk_current_employee_id() and endpoint = p_endpoint
  );
$$ language sql stable security definer;

revoke execute on function fa_owner_push_is_subscribed(text) from public, anon;
grant execute on function fa_owner_push_is_subscribed(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Construção dos relatórios — cada função monta título/corpo e
--    empilha na fila (due_at_ms = agora, entregue no próximo tick do
--    cron de despacho). money() em BRL local — sem depender do
--    formatador do client, o texto tem que existir mesmo se o app não
--    estiver aberto em lugar nenhum.
-- ---------------------------------------------------------------------
create or replace function fa_owner_report_money(p_cents bigint) returns text as $$
  select 'R$ ' || to_char((coalesce(p_cents, 0) / 100.0), 'FM999G999G990D00');
$$ language sql immutable;

create or replace function fa_owner_report_enqueue(
  p_unit_id uuid, p_report_type text, p_business_date date, p_title text, p_body text,
  p_dedupe_key text default null
) returns void as $$
begin
  if p_dedupe_key is not null then
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms, dedupe_key)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint, p_dedupe_key)
      on conflict (report_type, dedupe_key) where dedupe_key is not null do nothing;
  else
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint)
      on conflict (unit_id, report_type, business_date) where dedupe_key is null do nothing;
  end if;
end;
$$ language plpgsql volatile security definer;

-- 5a. Abertura — dispara ao abrir turno (trigger, ver seção 6).
create or replace function fa_owner_report_build_abertura(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = s.opened_by_employee_id
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'ABERTURA', v_shift.business_date,
    v_unit.emoji || ' Abertura ' || v_unit.name,
    v_operador || ' abriu o caixa às ' ||
      to_char(to_timestamp(v_shift.opened_at_ms / 1000.0) at time zone v_unit.timezone, 'HH24:MI') ||
      E'\nFundo de Caixa inicial: ' || fa_owner_report_money(v_shift.opening_cash_cents)
  );
end;
$$ language plpgsql volatile security definer;

-- 5b. Fechamento — mesmo modelo que o Owner já lia manualmente:
--   "[emoji] Fechamento [Unidade]
--    [operador] - Data: [dd/mm/aaaa, hh:mm]
--    Fundo de Caixa: R$ [x]
--    Valor do Envelope: R$ [y] - Valor faturado: Dinheiro: R$.., Crédito: R$.., Débito: R$.., Pix: R$.."
create or replace function fa_owner_report_build_fechamento(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
  v_envelope_cents bigint;
  v_fundo_cents bigint;
  v_dinheiro_cents bigint;
  v_credito_cents bigint;
  v_debito_cents bigint;
  v_pix_cents bigint;
  v_outros_cents bigint;
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = coalesce(s.closed_by_employee_id, s.opened_by_employee_id)
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  select coalesce(sum(amount_cents), 0) into v_envelope_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null;
  select fundo_caixa_cents into v_fundo_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and fundo_caixa_cents is not null
    order by at_ms desc limit 1;

  select
      coalesce(sum(p.amount_cents) filter (where p.method = 'DINHEIRO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'CREDITO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'DEBITO'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method = 'PIX'), 0),
      coalesce(sum(p.amount_cents) filter (where p.method not in ('DINHEIRO', 'CREDITO', 'DEBITO', 'PIX')), 0)
    into v_dinheiro_cents, v_credito_cents, v_debito_cents, v_pix_cents, v_outros_cents
    from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
    where o.shift_id = p_shift_id and o.status = 'PAGA';

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' Fechamento ' || v_unit.name,
    v_operador || ' - Data: ' ||
      to_char(to_timestamp(v_shift.closed_at_ms / 1000.0) at time zone v_unit.timezone, 'DD/MM/YYYY, HH24:MI') ||
      E'\nFundo de Caixa: ' || fa_owner_report_money(coalesce(v_fundo_cents, v_shift.opening_cash_cents)) ||
      E'\nValor do Envelope: ' || fa_owner_report_money(v_envelope_cents) ||
      E'\nValor faturado — Dinheiro: ' || fa_owner_report_money(v_dinheiro_cents) ||
      ', Crédito: ' || fa_owner_report_money(v_credito_cents) ||
      ', Débito: ' || fa_owner_report_money(v_debito_cents) ||
      ', Pix: ' || fa_owner_report_money(v_pix_cents) ||
      case when v_outros_cents > 0 then ', Outros: ' || fa_owner_report_money(v_outros_cents) else '' end
  );
end;
$$ language plpgsql volatile security definer;

-- 5c. Acompanhamento — 17h/20h, do dia corrente até o instante do envio.
create or replace function fa_owner_report_build_acompanhamento(p_unit_id uuid, p_slot text) returns void as $$
declare
  v_unit record;
  v_business_date date;
  v_faturado_cents bigint;
  v_pedidos integer;
  v_visitas integer;
  v_ticket_cents bigint;
  v_report_type text := case p_slot when '17H' then 'ACOMPANHAMENTO_17H' when '20H' then 'ACOMPANHAMENTO_20H' end;
begin
  select * into v_unit from fa_kiosk_units where id = p_unit_id;
  v_business_date := (now() at time zone v_unit.timezone)::date;

  select coalesce(sum(total_cents), 0), count(*) into v_faturado_cents, v_pedidos
    from fa_kiosk_orders where unit_id = p_unit_id and business_date = v_business_date and status = 'PAGA';

  select count(*) into v_visitas
    from fa_kiosk_sessions
    where unit_id = p_unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_business_date;

  v_ticket_cents := case when v_pedidos > 0 then round(v_faturado_cents::numeric / v_pedidos) else 0 end;

  perform fa_owner_report_enqueue(
    p_unit_id, v_report_type, v_business_date,
    v_unit.emoji || ' Acompanhamento ' || v_unit.name || ' — ' ||
      to_char(now() at time zone v_unit.timezone, 'HH24:MI'),
    'Faturado até agora: ' || fa_owner_report_money(v_faturado_cents) ||
      E'\nTicket médio: ' || fa_owner_report_money(v_ticket_cents) ||
      E'\nVisitas/locações: ' || v_visitas
  );
end;
$$ language plpgsql volatile security definer;

-- ---------------------------------------------------------------------
-- 6. Trigger — abertura/fechamento de caixa disparam o relatório sem
--    depender do client chamar mais nada além do fluxo que já existe
--    hoje (abrir turno / fechar turno).
-- ---------------------------------------------------------------------
create or replace function fa_owner_notify_on_shift_change() returns trigger as $$
begin
  if tg_op = 'INSERT' and new.status = 'ABERTO' then
    perform fa_owner_report_build_abertura(new.id);
  elsif tg_op = 'UPDATE' and old.status <> 'FECHADO' and new.status = 'FECHADO' then
    perform fa_owner_report_build_fechamento(new.id);
  end if;
  return new;
end;
$$ language plpgsql volatile security definer;

drop trigger if exists trg_fa_owner_notify_on_shift_change on fa_kiosk_shifts;
create trigger trg_fa_owner_notify_on_shift_change
  after insert or update on fa_kiosk_shifts
  for each row execute function fa_owner_notify_on_shift_change();

-- ---------------------------------------------------------------------
-- 7. Varredura periódica das janelas de 17h/20h (hora local de cada
--    unidade — unidades podem estar em fusos diferentes). Roda a cada 5
--    min; o unique index em (unit_id, report_type, business_date) é
--    quem garante "só um relatório por unidade por slot por dia" mesmo
--    que a janela de 5 minutos seja varrida mais de uma vez.
-- ---------------------------------------------------------------------
create or replace function fa_owner_reports_run_acompanhamento() returns void as $$
declare
  v_unit record;
  v_local_time time;
begin
  for v_unit in select * from fa_kiosk_units loop
    v_local_time := (now() at time zone v_unit.timezone)::time;
    if v_local_time between '17:00' and '17:04:59' then
      perform fa_owner_report_build_acompanhamento(v_unit.id, '17H');
    elsif v_local_time between '20:00' and '20:04:59' then
      perform fa_owner_report_build_acompanhamento(v_unit.id, '20H');
    end if;
  end loop;
end;
$$ language plpgsql volatile security definer;

do $$
begin
  perform cron.unschedule('fa-owner-report-acompanhamento');
exception when others then null;
end $$;

select cron.schedule('fa-owner-report-acompanhamento', '*/5 * * * *', $$ select fa_owner_reports_run_acompanhamento(); $$);

-- ---------------------------------------------------------------------
-- 8. Reivindicação atômica das notificações vencidas + fan-out para
--    todos os dispositivos de Owner inscritos (CTE: o UPDATE marca a
--    notificação como enviada uma vez só; o cross join replica para N
--    dispositivos sem reabrir a claim).
-- ---------------------------------------------------------------------
create or replace function fa_owner_push_claim_due(p_now_ms bigint) returns table (
  endpoint text, p256dh text, auth text, title text, body text
) as $$
  with due as (
    update fa_kiosk_owner_notifications
    set sent_at_ms = p_now_ms
    where sent_at_ms is null and due_at_ms <= p_now_ms
    returning title, body
  )
  select s.endpoint, s.p256dh, s.auth, d.title, d.body
  from due d cross join fa_kiosk_owner_push_subscriptions s;
$$ language sql volatile security definer;

revoke execute on function fa_owner_push_claim_due(bigint) from public;
grant execute on function fa_owner_push_claim_due(bigint) to service_role;

-- ---------------------------------------------------------------------
-- 9. Cron: dispara a edge function de envio a cada minuto (mesmo
--    padrão de fa-push-alert-dispatch).
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('fa-owner-report-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'fa-owner-report-dispatch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/owner-report-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
