-- Atualiza o CHECK constraint da tabela fa_kiosk_job_applications para permitir
-- todos os status previstos na UI do Banco de Talentos:
-- ('NOVO', 'LIDO', 'ESPERA', 'ENTREVISTA', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO')

do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint con
    join pg_class cl on con.conrelid = cl.oid
    where cl.relname = 'fa_kiosk_job_applications'
      and con.contype = 'c'
  ) loop
    execute format('alter table fa_kiosk_job_applications drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table fa_kiosk_job_applications
  add constraint fa_kiosk_job_applications_status_check
  check (status in ('NOVO', 'LIDO', 'ESPERA', 'ENTREVISTA', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO'));

