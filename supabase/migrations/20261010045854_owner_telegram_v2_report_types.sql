-- EXPORTADA da produção (supabase_migrations.schema_migrations, versão
-- 20261010045854, aplicada por brunofreitasbm@gmail.com em 2026-10-10). O SQL
-- abaixo é o texto aplicado, sem alterações; só este cabeçalho foi acrescentado
-- para o repositório voltar a refletir a produção. NÃO reaplicar na produção.

alter table public.fa_kiosk_owner_notifications drop constraint fa_kiosk_owner_notifications_report_type_check;
alter table public.fa_kiosk_owner_notifications add constraint fa_kiosk_owner_notifications_report_type_check
  check (report_type = any (array[
    'ABERTURA','ACOMPANHAMENTO_17H','ACOMPANHAMENTO_19H','ACOMPANHAMENTO_20H','FECHAMENTO',
    'DIVERGENCIA_FECHAMENTO','DIVERGENCIA_ABERTURA','RESUMO_SEMANAL','CANDIDATURA_TALENTOS',
    'OCORRENCIA_COLABORADOR','AVALIACAO_NEGATIVA','RESUMO_DIARIO','RESUMO_SEMANAL_CONSOLIDADO'
  ]::text[]));
