-- Remoção definitiva da gravação de voz / transcrição / Compêndio de Vendas.
--
-- 20260928020000_fa_voice_feature_disable.sql já tinha desligado a função
-- e apagado os dados; aqui o schema inteiro sai junto com o código
-- (worker do whisper.cpp, rota /api/voz, abas do Gerencial e as Edge
-- Functions sales-compendium-generate/-dispatch).
--
-- DROP TABLE leva junto índices, policies e o trigger de guarda; a função
-- do trigger é SECURITY DEFINER e fica órfã, então cai explicitamente.

do $$
begin
  perform cron.unschedule('fa-sales-compendium-monthly');
exception when others then null;
end $$;

drop table if exists fa_kiosk_sales_compendiums;
drop table if exists fa_kiosk_voice_transcripts;
drop table if exists fa_kiosk_voice_terminal_status;

drop function if exists fa_kiosk_voice_transcripts_guard_update();

delete from fa_kiosk_role_capabilities
 where capability in (
   'treinamento.transcricoes.read',
   'treinamento.transcricoes.write',
   'treinamento.compendio.gerar',
   'config.terminais.read'
 );

delete from fa_kiosk_app_settings
 where key in ('voice_recording_enabled', 'voice_whisper_model', 'voice_transcribe_hours');
