-- Relatório de Sessão em PDF ("Registro da Visita"): o texto da IA vira um
-- documento A4 com a marca, guardado em bucket PRIVADO, e o responsável recebe
-- no WhatsApp um link (botão) que abre o PDF.
--
-- Fluxo (session-report-dispatch): Gemini -> JSON (título, abertura, 4 áreas,
-- fechamento, destaque) -> PDF (pdf-lib) -> upload relatorios-sessao/<unit>/<id>.pdf
-- -> token público de 256 bits gravado UMA vez no relatório -> envio.
-- Link: /functions/v1/session-report-view?t=<token> -> 302 para signed URL de 1h.
--
-- Blindagem: o PDF carrega nota fixa (fora do alcance da IA) de que é registro
-- meramente observacional da brincadeira, sem caráter de sessão terapêutica,
-- atendimento, avaliação, diagnóstico, laudo ou parecer.

-- ---------------------------------------------------------------------
-- 1. Bucket privado — zero policies de INSERT/UPDATE (só service role escreve).
--    Leitura pelo Gerencial via createSignedUrl, guardada pela mesma capacidade
--    da tabela (padrão do bucket curriculos).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios-sessao', 'relatorios-sessao', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists fa_relatorios_sessao_read on storage.objects;
create policy fa_relatorios_sessao_read on storage.objects for select to authenticated
  using (bucket_id = 'relatorios-sessao' and fa_kiosk_can('relatorio_sessao.read'));

-- ---------------------------------------------------------------------
-- 2. Colunas do PDF no relatório
-- ---------------------------------------------------------------------
alter table fa_kiosk_session_reports
  add column if not exists pdf_path text,
  add column if not exists pdf_generated_at_ms bigint,
  add column if not exists public_token text,
  add column if not exists pdf_view_count integer not null default 0,
  add column if not exists pdf_last_viewed_at_ms bigint,
  add column if not exists ai_report jsonb;

create unique index if not exists idx_fa_session_reports_public_token
  on fa_kiosk_session_reports (public_token) where public_token is not null;

-- ---------------------------------------------------------------------
-- 3. Template com botão de link (purpose novo; a lista repete TODOS os vigentes)
-- ---------------------------------------------------------------------
alter table fa_crm_templates drop constraint if exists fa_crm_templates_purpose_check;
alter table fa_crm_templates add constraint fa_crm_templates_purpose_check
  check (purpose in (
    'GERAL', 'NPS', 'RENOVACAO', 'OPTIN', 'RELATORIO_SESSAO',
    'VISITA_BOAS_VINDAS', 'VISITA_EXCEDENTE', 'VISITA_RENOVACAO_OK', 'VISITA_FIDELIDADE',
    'MAPEAMENTO',
    'EXPIRACAO', 'RELATORIO_CUPOM', 'PREMIO_FIDELIDADE', 'NPS_PROMOTOR', 'NPS_DETRATOR',
    'UPSELL_PACOTE', 'CROSS_ATIVIDADE', 'CROSS_IRMAO', 'ANIVERSARIO', 'VIP', 'WINBACK',
    'OPTIN_MARKETING',
    'RELATORIO_SESSAO_PDF'
  ));

-- ---------------------------------------------------------------------
-- 4. RPCs (só a Edge Function, via service role)
-- ---------------------------------------------------------------------
-- Grava PDF + documento da IA. O token só é definido na primeira vez: o
-- "Reenviar" e o "Regerar" mantêm o mesmo link já entregue à família.
create or replace function fa_session_report_set_pdf(
  p_report_id uuid, p_pdf_path text, p_public_token text, p_ai_report jsonb
) returns text as $$
declare
  v_token text;
begin
  update fa_kiosk_session_reports set
    pdf_path = p_pdf_path,
    pdf_generated_at_ms = (extract(epoch from now()) * 1000)::bigint,
    public_token = coalesce(public_token, p_public_token),
    ai_report = coalesce(p_ai_report, ai_report)
  where id = p_report_id
  returning public_token into v_token;
  return v_token;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_set_pdf(uuid, text, text, jsonb) from public, anon, authenticated;

-- Abertura do link pelo responsável: conta a visualização e devolve o caminho
-- do PDF (null = token desconhecido ou PDF ainda não gerado).
create or replace function fa_session_report_register_view(p_token text, p_count boolean default true)
returns text as $$
declare
  v_path text;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  if p_count then
    update fa_kiosk_session_reports set
      pdf_view_count = pdf_view_count + 1,
      pdf_last_viewed_at_ms = (extract(epoch from now()) * 1000)::bigint
    where public_token = p_token and pdf_path is not null
    returning pdf_path into v_path;
  else
    select pdf_path into v_path from fa_kiosk_session_reports where public_token = p_token and pdf_path is not null;
  end if;
  return v_path;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_session_report_register_view(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. "Enviados hoje" passa a trazer o PDF e as visualizações
-- ---------------------------------------------------------------------
drop function if exists fa_session_reports_recent(uuid, bigint);
create or replace function fa_session_reports_recent(p_unit_id uuid, p_since_ms bigint)
returns table (
  id uuid, session_id uuid, child_name_snapshot text, filled_at_ms bigint, late boolean,
  whatsapp_status text, whatsapp_error text, ai_message text, filled_by_name text,
  pdf_path text, pdf_view_count integer, public_token text
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
           r.pdf_path, r.pdf_view_count, r.public_token
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
