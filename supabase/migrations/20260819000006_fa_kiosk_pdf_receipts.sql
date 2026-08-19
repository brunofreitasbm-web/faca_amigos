-- Suporte a cupons salvos em PDF quando a impressora estiver ausente ou falhar
alter table fa_kiosk_print_jobs drop constraint if exists fa_kiosk_print_jobs_status_check;
alter table fa_kiosk_print_jobs add constraint fa_kiosk_print_jobs_status_check check (status in ('PENDING', 'PRINTED', 'FAILED', 'SAVED_PDF'));

alter table fa_kiosk_print_jobs add column if not exists pdf_path text;
alter table fa_kiosk_print_jobs add column if not exists pdf_url text;

-- Função para limpar automaticamente do banco registros de PDF com mais de 10 dias
create or replace function fa_kiosk_cleanup_expired_pdf_receipts(days_retention integer default 10)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
  cutoff_ms bigint;
begin
  cutoff_ms := (extract(epoch from (now() - (days_retention || ' days')::interval)) * 1000)::bigint;

  delete from fa_kiosk_print_jobs
  where status = 'SAVED_PDF'
    and created_at_ms < cutoff_ms;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
