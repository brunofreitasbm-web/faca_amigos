-- Desativação completa da gravação de voz / transcrição / uso de IA
-- (Compêndio de Vendas) para atendimentos de check-in/check-out.
--
-- O código permanece no repositório (desligado via FACAAMIGOS_VOZ_ENABLED
-- e VOICE_RECORDING_DISABLED no cliente), mas os menus foram removidos do
-- Gerencial e esta migration:
--   1. desliga o cron mensal que gerava o Compêndio de Vendas com Gemini;
--   2. apaga os registros já existentes (transcrições, compêndios e status
--      de terminal) — dado pessoal (LGPD) que deixou de ter finalidade.

do $$
begin
  perform cron.unschedule('fa-sales-compendium-monthly');
exception when others then null;
end $$;

delete from fa_kiosk_sales_compendiums;
delete from fa_kiosk_voice_transcripts;
delete from fa_kiosk_voice_terminal_status;
