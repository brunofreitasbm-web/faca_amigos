-- Gravação de voz / transcrição local foi removida do app. A fila
-- voice_jobs (0007) não tem mais leitor nem escritor; dropar também apaga
-- os textos de transcrição que ainda estivessem no SQLite do terminal.
DROP INDEX IF EXISTS idx_voice_jobs_status;
DROP TABLE IF EXISTS voice_jobs;
