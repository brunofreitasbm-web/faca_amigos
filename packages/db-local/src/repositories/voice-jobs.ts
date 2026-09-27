import type { Db } from "../connection.js";

/**
 * Fila local de transcrição das gravações de balcão (migration 0007).
 * Ver o cabeçalho de 0007_voice_jobs.sql para o ciclo de status.
 */

export type VoiceJobStatus = "PENDING" | "PROCESSING" | "TRANSCRIBED" | "UPLOADED" | "FAILED";
export type VoiceMomento = "CHECKIN" | "CHECKOUT";

export interface VoiceJobRow {
  id: string;
  unit_id: string;
  employee_id: string;
  momento: VoiceMomento;
  session_ids_json: string;
  order_id: string | null;
  outcome: string | null;
  started_at_ms: number;
  ended_at_ms: number;
  duration_ms: number;
  client_label: string | null;
  wav_path: string | null;
  wav_bytes: number | null;
  status: VoiceJobStatus;
  attempts: number;
  next_attempt_at_ms: number;
  whisper_model: string | null;
  transcript_text: string | null;
  segments_json: string | null;
  transcript_status: string | null;
  error: string | null;
  supabase_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface NewVoiceJob {
  id: string;
  unitId: string;
  employeeId: string;
  momento: VoiceMomento;
  sessionIds: string[];
  orderId?: string | null;
  outcome?: string | null;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  clientLabel?: string | null;
  wavPath: string;
  wavBytes: number;
}

/** Máximo de tentativas (transcrição + upload somadas) antes de desistir. */
export const VOICE_JOB_MAX_ATTEMPTS = 8;
/** PROCESSING mais velho que isto é considerado órfão (crash no meio) e volta a PENDING. */
export const VOICE_JOB_STALE_PROCESSING_MS = 30 * 60_000;

/** Backoff exponencial com teto de 30 min: 30s, 60s, 2min, 4min, 8min, 16min, 30min... */
export function voiceJobBackoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 30_000, 30 * 60_000);
}

export function getVoiceJob(db: Db, id: string): VoiceJobRow | undefined {
  return db.prepare("SELECT * FROM voice_jobs WHERE id = ?").get(id) as VoiceJobRow | undefined;
}

/** Devolve false se já existia (POST repetido pelo retry do cliente). */
export function insertVoiceJob(db: Db, job: NewVoiceJob, nowMs: number): boolean {
  if (getVoiceJob(db, job.id)) return false;
  db.prepare(
    `INSERT INTO voice_jobs (
       id, unit_id, employee_id, momento, session_ids_json, order_id, outcome,
       started_at_ms, ended_at_ms, duration_ms, client_label, wav_path, wav_bytes,
       status, attempts, next_attempt_at_ms, created_at_ms, updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 0, ?, ?)`,
  ).run(
    job.id,
    job.unitId,
    job.employeeId,
    job.momento,
    JSON.stringify(job.sessionIds ?? []),
    job.orderId ?? null,
    job.outcome ?? null,
    job.startedAtMs,
    job.endedAtMs,
    job.durationMs,
    job.clientLabel ?? null,
    job.wavPath,
    job.wavBytes,
    nowMs,
    nowMs,
  );
  return true;
}

/**
 * Reivindica o próximo job pronto para trabalhar (PENDING → transcrever;
 * TRANSCRIBED → subir), o mais antigo primeiro. Um UPDATE atômico marca
 * PROCESSING só para PENDING; TRANSCRIBED é devolvido sem mudar de status
 * (o upload é rápido e idempotente — a PK remota é o próprio id).
 */
export function claimNextVoiceJob(db: Db, nowMs: number, opts: { allowTranscribe: boolean; allowUpload: boolean }): VoiceJobRow | undefined {
  const statuses: VoiceJobStatus[] = [];
  if (opts.allowTranscribe) statuses.push("PENDING");
  if (opts.allowUpload) statuses.push("TRANSCRIBED");
  if (statuses.length === 0) return undefined;
  const placeholders = statuses.map(() => "?").join(", ");
  const next = db
    .prepare(
      `SELECT * FROM voice_jobs
        WHERE status IN (${placeholders}) AND next_attempt_at_ms <= ?
        ORDER BY created_at_ms ASC LIMIT 1`,
    )
    .get(...statuses, nowMs) as VoiceJobRow | undefined;
  if (!next) return undefined;
  if (next.status === "PENDING") {
    const res = db
      .prepare("UPDATE voice_jobs SET status = 'PROCESSING', updated_at_ms = ? WHERE id = ? AND status = 'PENDING'")
      .run(nowMs, next.id);
    if (Number(res.changes) !== 1) return undefined;
    return { ...next, status: "PROCESSING", updated_at_ms: nowMs };
  }
  return next;
}

export function markVoiceJobTranscribed(
  db: Db,
  id: string,
  data: { transcriptText: string; segmentsJson: string; whisperModel: string; transcriptStatus: "DONE" | "EMPTY" },
  nowMs: number,
): void {
  db.prepare(
    `UPDATE voice_jobs
        SET status = 'TRANSCRIBED', transcript_text = ?, segments_json = ?, whisper_model = ?, transcript_status = ?,
            wav_path = NULL, error = NULL, next_attempt_at_ms = 0, updated_at_ms = ?
      WHERE id = ?`,
  ).run(data.transcriptText, data.segmentsJson, data.whisperModel, data.transcriptStatus, nowMs, id);
}

export function markVoiceJobUploaded(db: Db, id: string, supabaseId: string, nowMs: number): void {
  db.prepare("UPDATE voice_jobs SET status = 'UPLOADED', supabase_id = ?, error = NULL, updated_at_ms = ? WHERE id = ?").run(
    supabaseId,
    nowMs,
    id,
  );
}

/**
 * Registra uma falha. Volta ao status "de origem" (PENDING se ainda não
 * transcreveu, TRANSCRIBED se só o upload falhou) com backoff; após
 * VOICE_JOB_MAX_ATTEMPTS vira FAILED definitivo. Devolve o status final.
 */
export function markVoiceJobFailed(db: Db, id: string, error: string, nowMs: number): VoiceJobStatus {
  const row = getVoiceJob(db, id);
  if (!row) return "FAILED";
  const attempts = row.attempts + 1;
  const origin: VoiceJobStatus = row.transcript_text !== null ? "TRANSCRIBED" : "PENDING";
  const final: VoiceJobStatus = attempts >= VOICE_JOB_MAX_ATTEMPTS ? "FAILED" : origin;
  db.prepare(
    `UPDATE voice_jobs
        SET status = ?, attempts = ?, next_attempt_at_ms = ?, error = ?, updated_at_ms = ?
      WHERE id = ?`,
  ).run(final, attempts, nowMs + voiceJobBackoffMs(attempts), error.slice(0, 2000), nowMs, id);
  return final;
}

/** Marca o WAV como apagado (usado pela limpeza de FAILED/órfãos). */
export function clearVoiceJobWav(db: Db, id: string, nowMs: number): void {
  db.prepare("UPDATE voice_jobs SET wav_path = NULL, updated_at_ms = ? WHERE id = ?").run(nowMs, id);
}

/** PROCESSING travado (crash do app no meio do whisper) volta a PENDING. Devolve quantos. */
export function resetStaleVoiceProcessing(db: Db, nowMs: number): number {
  const res = db
    .prepare("UPDATE voice_jobs SET status = 'PENDING', updated_at_ms = ? WHERE status = 'PROCESSING' AND updated_at_ms < ?")
    .run(nowMs, nowMs - VOICE_JOB_STALE_PROCESSING_MS);
  return Number(res.changes);
}

export interface VoiceQueueStats {
  pending: number;
  processing: number;
  transcribed: number;
  uploaded: number;
  failed: number;
  lastError: string | null;
  lastUploadedAtMs: number | null;
}

export function voiceQueueStats(db: Db): VoiceQueueStats {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM voice_jobs GROUP BY status").all() as { status: VoiceJobStatus; n: number }[];
  const count = (s: VoiceJobStatus) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  const lastErr = db.prepare("SELECT error FROM voice_jobs WHERE error IS NOT NULL ORDER BY updated_at_ms DESC LIMIT 1").get() as
    | { error: string }
    | undefined;
  const lastUp = db.prepare("SELECT MAX(updated_at_ms) AS ms FROM voice_jobs WHERE status = 'UPLOADED'").get() as { ms: number | null } | undefined;
  return {
    pending: count("PENDING"),
    processing: count("PROCESSING"),
    transcribed: count("TRANSCRIBED"),
    uploaded: count("UPLOADED"),
    failed: count("FAILED"),
    lastError: lastErr?.error ?? null,
    lastUploadedAtMs: lastUp?.ms ?? null,
  };
}

export function listVoiceJobs(db: Db, limit = 20): VoiceJobRow[] {
  return db.prepare("SELECT * FROM voice_jobs ORDER BY created_at_ms DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))) as unknown as VoiceJobRow[];
}

/** Jobs cujo WAV ainda está no disco (para a limpeza de órfãos no boot). */
export function listVoiceJobsWithWav(db: Db): VoiceJobRow[] {
  return db.prepare("SELECT * FROM voice_jobs WHERE wav_path IS NOT NULL").all() as unknown as VoiceJobRow[];
}

/** Expurga jobs UPLOADED antigos do SQLite (o texto já vive no Supabase). Devolve quantos. */
export function purgeUploadedVoiceJobs(db: Db, olderThanMs: number): number {
  const res = db.prepare("DELETE FROM voice_jobs WHERE status = 'UPLOADED' AND updated_at_ms < ?").run(olderThanMs);
  return Number(res.changes);
}
