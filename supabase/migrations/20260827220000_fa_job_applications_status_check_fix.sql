-- Atualiza o CHECK constraint da tabela fa_kiosk_job_applications para permitir
-- todos os status previstos na UI do Banco de Talentos:
-- ('NOVO', 'LIDO', 'ESPERA', 'ENTREVISTA', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO')

alter table fa_kiosk_job_applications
  drop constraint if exists fa_kiosk_job_applications_status_check;

alter table fa_kiosk_job_applications
  add constraint fa_kiosk_job_applications_status_check
  check (status in ('NOVO', 'LIDO', 'ESPERA', 'ENTREVISTA', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO'));
