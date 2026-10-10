-- Olhar FaçaAmigos: pendência não some sozinha.
-- Antes, o relatório não preenchido saía da fila 12h depois da saída, e o
-- relatório não enviado só aparecia enquanto fosse "de hoje" (meia-noite
-- local): quem não resolvia no mesmo dia perdia o alerta e o responsável
-- ficava sem receber. Agora ambos ficam na tela do operador até resolver.

-- 1) Não preenchido: sem janela de 12h. O piso é o início do recurso
-- (28/09/2026 00:00 -03), para sessões antigas não inundarem a fila.
create or replace function fa_session_reports_pending(p_unit_id uuid)
returns table (
  session_id uuid, child_id uuid, child_name text, guardian_name text, guardian_phone_present boolean,
  checkin_at_ms bigint, checkout_at_ms bigint, eligible_minutes integer, plan_name text, deadline_ms bigint
) as $$
begin
  if not fa_kiosk_can('relatorio_sessao.write') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select s.id, s.child_id, s.child_name_snapshot, g.full_name,
           (g.phone_e164 is not null and g.phone_e164 <> ''),
           s.checkin_at_ms, s.checkout_at_ms, m.minutes, p.name, s.checkout_at_ms + 2400000
    from fa_kiosk_sessions s
    left join fa_kiosk_plans p on p.id = s.plan_id
    left join fa_kiosk_guardians g on g.id = s.guardian_id
    cross join lateral (
      select greatest(
        coalesce(fa_kiosk_plan_duration_minutes(p.duration_value, p.duration_unit), 0),
        coalesce(s.hour_bank_allocated_minutes, 0),
        coalesce(s.package_allocated_minutes, 0),
        coalesce(s.child_credit_allocated_minutes, 0)
      ) as minutes
    ) m
    where s.unit_id = p_unit_id
      and s.status = 'FINALIZADA'
      and s.checkout_at_ms is not null
      and s.checkout_at_ms >= 1790564400000
      and s.child_id is not null
      and m.minutes >= 60
      and not exists (select 1 from fa_kiosk_session_reports r where r.session_id = s.id)
    order by s.checkout_at_ms asc;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_session_reports_pending(uuid) from public, anon;
grant execute on function fa_session_reports_pending(uuid) to authenticated;

-- 2) Preenchido mas não entregue: qualquer dia, até virar SENT/SENT_MANUAL.
-- PENDING só conta após 10 min (o envio automático roda logo após o submit).
-- SKIPPED_NO_CONSENT/OPT_OUT/NO_PHONE ficam de fora: são decisão do responsável
-- ou cadastro, não falha de envio.
create or replace function fa_session_reports_unsent(p_unit_id uuid)
returns table (
  id uuid, session_id uuid, child_name_snapshot text, filled_at_ms bigint, late boolean,
  whatsapp_status text, whatsapp_error text, ai_message text, filled_by_name text,
  pdf_path text, pdf_view_count integer, public_token text,
  olhar_seq integer, olhar_edition text
) as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_all boolean := fa_kiosk_can('relatorio_sessao.read');
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not fa_kiosk_can('relatorio_sessao.write') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select r.id, r.session_id, r.child_name_snapshot, r.filled_at_ms, r.late,
           r.whatsapp_status, r.whatsapp_error, r.ai_message, e.full_name,
           r.pdf_path, r.pdf_view_count, r.public_token,
           r.olhar_seq, r.olhar_edition
    from fa_kiosk_session_reports r
    join fa_kiosk_employees e on e.id = r.filled_by_employee_id
    where r.unit_id = p_unit_id
      and (v_all or r.filled_by_employee_id = v_emp)
      and (
        r.whatsapp_status in ('FAILED', 'SKIPPED_NO_TEMPLATE', 'SKIPPED_NO_CHANNEL')
        or (r.whatsapp_status = 'PENDING' and r.filled_at_ms < v_now_ms - 10 * 60 * 1000)
      )
    order by r.filled_at_ms asc
    limit 200;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_session_reports_unsent(uuid) from public, anon;
grant execute on function fa_session_reports_unsent(uuid) to authenticated;
