-- Fila LOCAL de transcrição das gravações de balcão (check-in/check-out).
-- A SPA envia o WAV para o Fastify local (POST /api/voz/recordings), que
-- grava o arquivo em userData/voz/inbox e registra aqui; o worker do
-- processo main (apps/kiosk/src/main/voiceWorker.ts) roda o whisper.cpp,
-- guarda o texto nesta linha, APAGA o WAV e sobe o texto para
-- fa_kiosk_voice_transcripts no Supabase.
--
-- Ciclo de status:
--   PENDING      → WAV no disco, aguardando transcrição
--   PROCESSING   → whisper rodando (reset para PENDING se ficar > 30 min)
--   TRANSCRIBED  → texto pronto, WAV já apagado, aguardando upload
--   UPLOADED     → linha existe no Supabase; pode ser expurgada depois
--   FAILED       → desistiu após N tentativas (WAV apagado mesmo assim)
--
-- Sem FK para units/employees de propósito (mesma lição de
-- 0005_terminal_settings.sql: a tabela `units` local fica vazia em
-- produção e a FK derrubaria todo INSERT em silêncio).

CREATE TABLE IF NOT EXISTS voice_jobs (
  id TEXT PRIMARY KEY,                 -- recordingId gerado no cliente (idempotência do POST e da linha remota)
  unit_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  momento TEXT NOT NULL CHECK (momento IN ('CHECKIN', 'CHECKOUT')),
  session_ids_json TEXT NOT NULL DEFAULT '[]',
  order_id TEXT,
  outcome TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  client_label TEXT,
  wav_path TEXT,                       -- NULL depois de apagado
  wav_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'TRANSCRIBED', 'UPLOADED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
  whisper_model TEXT,
  transcript_text TEXT,
  segments_json TEXT,
  transcript_status TEXT,              -- 'DONE' | 'EMPTY' (espelha o status remoto)
  error TEXT,
  supabase_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_jobs_status ON voice_jobs (status, next_attempt_at_ms);
