-- Remoção definitiva da gravação de voz / transcrição / Compêndio de Vendas.
-- Os dados já foram apagados e o cron desligado em
-- 20260928020000_fa_voice_feature_disable.sql; aqui saem as tabelas e as
-- capabilities de RBAC. As Edge Functions sales-compendium-generate e
-- sales-compendium-dispatch devem ser removidas do projeto Supabase
-- (`supabase functions delete <nome>`).

do $$
begin
  perform cron.unschedule('fa-sales-compendium-monthly');
exception when others then null;
end $$;

drop table if exists fa_kiosk_sales_compendiums cascade;
drop table if exists fa_kiosk_voice_transcripts cascade;
drop table if exists fa_kiosk_voice_terminal_status cascade;

delete from fa_kiosk_role_capabilities
 where capability in (
  'treinamento.transcricoes.read',
  'treinamento.transcricoes.write',
  'treinamento.compendio.gerar',
  'config.terminais.read'
 );
