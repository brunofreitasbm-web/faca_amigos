-- Trilha de Olhares: cada criança recebe Olhares sequenciais (1º, 2º, 3º…) e
-- cada um é diferente do anterior (ESTREIA / CONTINUIDADE / MARCO com
-- retrospectiva). O nº e o tipo ficam gravados UMA vez: regerar o PDF não
-- renumera a trilha.

alter table fa_kiosk_session_reports
  add column if not exists olhar_seq integer,
  add column if not exists olhar_edition text;

alter table fa_kiosk_session_reports drop constraint if exists fa_session_reports_olhar_edition_check;
alter table fa_kiosk_session_reports add constraint fa_session_reports_olhar_edition_check
  check (olhar_edition is null or olhar_edition in ('ESTREIA', 'CONTINUIDADE', 'MARCO'));

-- Mesma função de antes + nº/tipo do Olhar (defaults nulos: chamadas antigas continuam valendo).
drop function if exists fa_session_report_set_pdf(uuid, text, text, jsonb);
create or replace function fa_session_report_set_pdf(
  p_report_id uuid, p_pdf_path text, p_public_token text, p_ai_report jsonb,
  p_olhar_seq integer default null, p_olhar_edition text default null
) returns text as $$
declare
  v_token text;
begin
  update fa_kiosk_session_reports set
    pdf_path = p_pdf_path,
    pdf_generated_at_ms = (extract(epoch from now()) * 1000)::bigint,
    public_token = coalesce(public_token, p_public_token),
    ai_report = coalesce(p_ai_report, ai_report),
    olhar_seq = coalesce(olhar_seq, p_olhar_seq),
    olhar_edition = coalesce(olhar_edition, p_olhar_edition)
  where id = p_report_id
  returning public_token into v_token;
  return v_token;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_set_pdf(uuid, text, text, jsonb, integer, text) from public, anon, authenticated;

-- "Enviados hoje" passa a trazer o nº e o tipo do Olhar.
drop function if exists fa_session_reports_recent(uuid, bigint);
create or replace function fa_session_reports_recent(p_unit_id uuid, p_since_ms bigint)
returns table (
  id uuid, session_id uuid, child_name_snapshot text, filled_at_ms bigint, late boolean,
  whatsapp_status text, whatsapp_error text, ai_message text, filled_by_name text,
  pdf_path text, pdf_view_count integer, public_token text,
  olhar_seq integer, olhar_edition text
) as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_all boolean := fa_kiosk_can('relatorio_sessao.read');
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
      and r.filled_at_ms >= p_since_ms
      and (v_all or r.filled_by_employee_id = v_emp)
    order by r.filled_at_ms desc
    limit 200;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_session_reports_recent(uuid, bigint) from public, anon;
grant execute on function fa_session_reports_recent(uuid, bigint) to authenticated;
