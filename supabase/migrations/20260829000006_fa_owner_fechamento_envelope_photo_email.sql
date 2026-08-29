-- =====================================================================
-- Foto do Envelope no e-mail de Fechamento
-- =====================================================================
-- fa_kiosk_cash_movements.photo_url (20260808070000) já guarda a URL
-- pública (bucket envelope-fotos, leitura pública) da foto tirada no
-- registro do envelope (SANGRIA). fa_owner_report_build_fechamento já
-- lê esse movimento para calcular o valor do envelope — passa a também
-- levar a foto até o e-mail.
--
-- O push continua texto puro (photo_url é ignorada no payload do
-- webpush) — só o canal de e-mail (owner-email-dispatch) monta um corpo
-- HTML com a imagem embutida quando photo_url não é nula.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Coluna nova na fila — nula para todo relatório que não seja
--    Fechamento com envelope fotografado.
-- ---------------------------------------------------------------------
alter table fa_kiosk_owner_notifications add column if not exists photo_url text;

-- ---------------------------------------------------------------------
-- 2. fa_owner_report_enqueue ganha p_photo_url (trailing, default null —
--    todo chamador existente continua funcionando sem alteração).
-- ---------------------------------------------------------------------
create or replace function fa_owner_report_enqueue(
  p_unit_id uuid, p_report_type text, p_business_date date, p_title text, p_body text,
  p_dedupe_key text default null, p_photo_url text default null
) returns void as $$
begin
  if p_dedupe_key is not null then
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms, dedupe_key, photo_url)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint, p_dedupe_key, p_photo_url)
      on conflict (report_type, dedupe_key) where dedupe_key is not null do nothing;
  else
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms, photo_url)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint, p_photo_url)
      on conflict (unit_id, report_type, business_date) where dedupe_key is null do nothing;
  end if;
end;
$$ language plpgsql volatile security definer;

-- ---------------------------------------------------------------------
-- 3. Fechamento — busca a foto do envelope mais recente do turno
--    (mesma condição já usada para somar v_envelope_cents) e repassa
--    para o enqueue.
-- ---------------------------------------------------------------------
create or replace function fa_owner_report_build_fechamento(p_shift_id uuid) returns void as $$
declare
  v_shift record;
  v_unit record;
  v_operador text;
  v_envelope_cents bigint;
  v_envelope_photo_url text;
  v_fundo_cents bigint;
  v_dinheiro_cents bigint;
  v_credito_cents bigint;
  v_debito_cents bigint;
  v_pix_cents bigint;
  v_outros_cents bigint;
  v_faturado_total_cents bigint;
  v_visitas integer;
  v_daily_goal_cents bigint := 0;
  v_meta_pct numeric;
  v_meta_str text := '';
begin
  select s.*, e.full_name as operador_name into v_shift
    from fa_kiosk_shifts s left join fa_kiosk_employees e on e.id = coalesce(s.closed_by_employee_id, s.opened_by_employee_id)
    where s.id = p_shift_id;
  select * into v_unit from fa_kiosk_units where id = v_shift.unit_id;
  v_operador := coalesce(v_shift.operador_name, 'Operador');

  select coalesce(sum(amount_cents), 0) into v_envelope_cents
    from fa_kiosk_cash_movements where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null;

  select photo_url into v_envelope_photo_url
    from fa_kiosk_cash_movements
    where shift_id = p_shift_id and kind = 'SANGRIA' and envelope_number is not null and photo_url is not null
    order by at_ms desc limit 1;

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

  v_faturado_total_cents := v_dinheiro_cents + v_credito_cents + v_debito_cents + v_pix_cents + v_outros_cents;

  -- Sessões/locações do dia
  select count(*) into v_visitas
    from fa_kiosk_sessions
    where unit_id = v_shift.unit_id
      and (to_timestamp(checkin_at_ms / 1000.0) at time zone v_unit.timezone)::date = v_shift.business_date;

  -- Meta de faturamento diária em fa_kiosk_app_settings
  select coalesce(value::bigint, 0) into v_daily_goal_cents
    from fa_kiosk_app_settings
    where unit_id = v_shift.unit_id and key = 'daily_goal_cents';

  if v_daily_goal_cents > 0 then
    v_meta_pct := round(((v_faturado_total_cents::numeric / v_daily_goal_cents::numeric) * 100), 1);
    v_meta_str := E'\nMeta do dia: ' || fa_owner_report_money(v_daily_goal_cents) ||
                  ' (' || v_meta_pct || '% atingida)';
  else
    v_meta_str := E'\nMeta do dia: Não definida';
  end if;

  perform fa_owner_report_enqueue(
    v_shift.unit_id, 'FECHAMENTO', v_shift.business_date,
    v_unit.emoji || ' Fechamento ' || v_unit.name,
    v_operador || ' - Data: ' ||
      to_char(to_timestamp(v_shift.closed_at_ms / 1000.0) at time zone v_unit.timezone, 'DD/MM/YYYY, HH24:MI') ||
      E'\nValor Faturado: ' || fa_owner_report_money(v_faturado_total_cents) ||
      v_meta_str ||
      E'\nTotal de sessões/locações: ' || v_visitas ||
      E'\nFundo de Caixa: ' || fa_owner_report_money(coalesce(v_fundo_cents, v_shift.opening_cash_cents)) ||
      E'\nValor em Envelope: ' || fa_owner_report_money(v_envelope_cents) ||
      E'\nDetalhamento faturado — Dinheiro: ' || fa_owner_report_money(v_dinheiro_cents) ||
      ', Crédito: ' || fa_owner_report_money(v_credito_cents) ||
      ', Débito: ' || fa_owner_report_money(v_debito_cents) ||
      ', Pix: ' || fa_owner_report_money(v_pix_cents) ||
      case when v_outros_cents > 0 then ', Outros: ' || fa_owner_report_money(v_outros_cents) else '' end,
    p_photo_url := v_envelope_photo_url
  );
end;
$$ language plpgsql volatile security definer;

-- ---------------------------------------------------------------------
-- 4. Canal de e-mail passa a levar a photo_url junto — muda a forma do
--    retorno (nova coluna), então precisa de drop antes do create.
-- ---------------------------------------------------------------------
drop function if exists fa_owner_email_claim_due(bigint);

create function fa_owner_email_claim_due(p_now_ms bigint) returns table (
  notification_id uuid, title text, body text, recipient_email text, photo_url text
) as $$
  with due as (
    update fa_kiosk_owner_notifications
    set emailed_at_ms = p_now_ms
    where emailed_at_ms is null
      and due_at_ms <= p_now_ms
      and report_type in ('ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_FECHAMENTO')
    returning id, title, body, photo_url
  )
  select d.id, d.title, d.body, e.email, d.photo_url
  from due d
  cross join fa_kiosk_employees e
  where e.role = 'ADMIN' and e.email is not null and length(trim(e.email)) > 0;
$$ language sql volatile security definer;

revoke execute on function fa_owner_email_claim_due(bigint) from public;
grant execute on function fa_owner_email_claim_due(bigint) to service_role;
