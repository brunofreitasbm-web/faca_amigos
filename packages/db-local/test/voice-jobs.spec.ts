import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import {
  claimNextVoiceJob,
  insertVoiceJob,
  markVoiceJobFailed,
  markVoiceJobTranscribed,
  markVoiceJobUploaded,
  resetStaleVoiceProcessing,
  voiceJobBackoffMs,
  voiceQueueStats,
  VOICE_JOB_MAX_ATTEMPTS,
  VOICE_JOB_STALE_PROCESSING_MS,
} from "../src/repositories/voice-jobs.js";
import type { Db } from "../src/connection.js";

let db: Db;
const NOW = 1_700_000_000_000;

function newJob(id: string) {
  return {
    id,
    unitId: "u1",
    employeeId: "e1",
    momento: "CHECKIN" as const,
    sessionIds: ["s1"],
    startedAtMs: NOW - 20_000,
    endedAtMs: NOW,
    durationMs: 20_000,
    wavPath: `/tmp/${id}.wav`,
    wavBytes: 640_000,
  };
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("voice_jobs", () => {
  it("insere uma vez e ignora o POST repetido", () => {
    expect(insertVoiceJob(db, newJob("a"), NOW)).toBe(true);
    expect(insertVoiceJob(db, newJob("a"), NOW)).toBe(false);
    expect(voiceQueueStats(db).pending).toBe(1);
  });

  it("reivindica o PENDING mais antigo e marca PROCESSING", () => {
    insertVoiceJob(db, newJob("b"), NOW + 1);
    insertVoiceJob(db, newJob("a"), NOW);
    const claimed = claimNextVoiceJob(db, NOW + 10, { allowTranscribe: true, allowUpload: true });
    expect(claimed?.id).toBe("a");
    expect(claimed?.status).toBe("PROCESSING");
    const next = claimNextVoiceJob(db, NOW + 10, { allowTranscribe: true, allowUpload: true });
    expect(next?.id).toBe("b");
  });

  it("ciclo completo: transcreve (apaga wav_path), sobe, e o TRANSCRIBED é devolvido para upload", () => {
    insertVoiceJob(db, newJob("a"), NOW);
    claimNextVoiceJob(db, NOW, { allowTranscribe: true, allowUpload: false });
    markVoiceJobTranscribed(db, "a", { transcriptText: "olá", segmentsJson: "[]", whisperModel: "ggml-small", transcriptStatus: "DONE" }, NOW + 1);

    // Com transcrição desligada (horário comercial), só upload é servido.
    const forUpload = claimNextVoiceJob(db, NOW + 2, { allowTranscribe: false, allowUpload: true });
    expect(forUpload?.id).toBe("a");
    expect(forUpload?.status).toBe("TRANSCRIBED");
    expect(forUpload?.wav_path).toBeNull();

    markVoiceJobUploaded(db, "a", "a", NOW + 3);
    const stats = voiceQueueStats(db);
    expect(stats.uploaded).toBe(1);
    expect(stats.lastUploadedAtMs).toBe(NOW + 3);
    expect(claimNextVoiceJob(db, NOW + 4, { allowTranscribe: true, allowUpload: true })).toBeUndefined();
  });

  it("falha volta ao status de origem com backoff e vira FAILED após o teto", () => {
    insertVoiceJob(db, newJob("a"), NOW);
    claimNextVoiceJob(db, NOW, { allowTranscribe: true, allowUpload: true });
    expect(markVoiceJobFailed(db, "a", "whisper timeout", NOW)).toBe("PENDING");
    // Em backoff: não é reivindicado antes da hora.
    expect(claimNextVoiceJob(db, NOW + 1, { allowTranscribe: true, allowUpload: true })).toBeUndefined();
    expect(claimNextVoiceJob(db, NOW + voiceJobBackoffMs(1) + 1, { allowTranscribe: true, allowUpload: true })?.id).toBe("a");

    let final = "PENDING";
    for (let i = 2; i <= VOICE_JOB_MAX_ATTEMPTS; i++) final = markVoiceJobFailed(db, "a", `tentativa ${i}`, NOW);
    expect(final).toBe("FAILED");
    expect(voiceQueueStats(db).failed).toBe(1);
    expect(voiceQueueStats(db).lastError).toBe(`tentativa ${VOICE_JOB_MAX_ATTEMPTS}`);
  });

  it("falha de upload mantém o texto e volta a TRANSCRIBED", () => {
    insertVoiceJob(db, newJob("a"), NOW);
    claimNextVoiceJob(db, NOW, { allowTranscribe: true, allowUpload: true });
    markVoiceJobTranscribed(db, "a", { transcriptText: "texto", segmentsJson: "[]", whisperModel: "ggml-small", transcriptStatus: "DONE" }, NOW);
    expect(markVoiceJobFailed(db, "a", "sem rede", NOW)).toBe("TRANSCRIBED");
  });

  it("PROCESSING órfão volta a PENDING depois do prazo", () => {
    insertVoiceJob(db, newJob("a"), NOW);
    claimNextVoiceJob(db, NOW, { allowTranscribe: true, allowUpload: true });
    expect(resetStaleVoiceProcessing(db, NOW + 1000)).toBe(0);
    expect(resetStaleVoiceProcessing(db, NOW + VOICE_JOB_STALE_PROCESSING_MS + 1)).toBe(1);
    expect(voiceQueueStats(db).pending).toBe(1);
  });

  it("backoff cresce e tem teto de 30 min", () => {
    expect(voiceJobBackoffMs(1)).toBe(30_000);
    expect(voiceJobBackoffMs(2)).toBe(60_000);
    expect(voiceJobBackoffMs(20)).toBe(30 * 60_000);
  });
});
