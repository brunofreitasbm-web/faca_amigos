-- Remove a fila local de transcrição de voz (funcionalidade descontinuada).
-- Terminais que já aplicaram a antiga 0007_voice_jobs.sql perdem a tabela;
-- instalações novas nunca a criam.
DROP INDEX IF EXISTS idx_voice_jobs_status;
DROP TABLE IF EXISTS voice_jobs;
