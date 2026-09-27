import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { insertVoiceJob, listVoiceJobs, voiceQueueStats } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { voiceRecordingMetaSchema } from "../schemas.js";
import { ValidationError, parseBody } from "../validate.js";
import { getVoiceWorkerStatus, notifyVoiceJobEnqueued } from "../../main/voiceWorkerControl.js";

const MIN_DURATION_MS = 4_000;
const MAX_DURATION_MS = 11 * 60_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Confere o cabeçalho RIFF/WAVE e os parâmetros PCM que o whisper.cpp exige (16 kHz, mono, 16 bit). */
function isValidPcm16kMonoWav(buf: Buffer): boolean {
  if (buf.length < 44) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return false;
  // O bloco "fmt " normalmente começa no offset 12, mas não confiamos em
  // posição fixa: alguns encoders inserem chunks extras antes dele.
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      const audioFormat = buf.readUInt16LE(offset + 8);
      const channels = buf.readUInt16LE(offset + 10);
      const sampleRate = buf.readUInt32LE(offset + 12);
      const bitsPerSample = buf.readUInt16LE(offset + 22);
      return audioFormat === 1 && channels === 1 && sampleRate === 16000 && bitsPerSample === 16;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return false;
}

/**
 * Gravação de voz do balcão (check-in/check-out) — ver plano em
 * docs/voz. A rota só grava o WAV em disco e enfileira o job em SQLite; a
 * transcrição roda no worker do processo main (voiceWorker.ts), que este
 * módulo nunca importa diretamente (evitaria arrastar electron/supabase-js
 * para dentro de src/server, quebrando os testes sem Electron).
 */
export function registerVozRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.register(async (voz) => {
    // addContentTypeParser fica DENTRO do plugin encapsulado — não vaza
    // para as demais rotas, que continuam esperando JSON.
    voz.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_BODY_BYTES }, (_req, body, done) => {
      done(null, body);
    });

    voz.post("/recordings", async (req, reply) => {
      if (!ctx.voiceDir) {
        return reply.code(503).send({ error: "VOZ_INDISPONIVEL", message: "Gravação de voz não configurada neste terminal." });
      }

      const metaHeader = req.headers["x-voz-meta"];
      if (typeof metaHeader !== "string") {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Cabeçalho X-Voz-Meta ausente." });
      }
      let metaJson: unknown;
      try {
        metaJson = JSON.parse(metaHeader);
      } catch {
        return reply.code(400).send({ error: "VALIDATION_ERROR", message: "X-Voz-Meta não é um JSON válido." });
      }
      const meta = parseBody(voiceRecordingMetaSchema, metaJson);

      if (meta.durationMs < MIN_DURATION_MS) {
        // Gravação abaixo do mínimo (clique acidental): aceita sem gravar
        // nada — o cliente já deveria ter descartado, isto é só a rede de
        // segurança do lado do servidor.
        return reply.code(204).send();
      }
      if (meta.durationMs > MAX_DURATION_MS) {
        return reply.code(400).send({ error: "DURACAO_EXCEDIDA", message: "Gravação acima do limite de 11 minutos." });
      }

      const wav = req.body as Buffer;
      if (!Buffer.isBuffer(wav) || !isValidPcm16kMonoWav(wav)) {
        return reply.code(400).send({ error: "WAV_INVALIDO", message: "Áudio precisa ser WAV PCM16 mono 16kHz." });
      }

      const inboxDir = join(ctx.voiceDir, "inbox");
      if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
      const wavPath = join(inboxDir, `${meta.recordingId}.wav`);

      const inserted = insertVoiceJob(
        ctx.db,
        {
          id: meta.recordingId,
          unitId: meta.unitId,
          employeeId: meta.employeeId,
          momento: meta.momento,
          sessionIds: meta.sessionIds,
          orderId: meta.orderId ?? null,
          outcome: meta.outcome ?? null,
          startedAtMs: meta.startedAtMs,
          endedAtMs: meta.endedAtMs,
          durationMs: meta.durationMs,
          clientLabel: meta.clientLabel ?? null,
          wavPath,
          wavBytes: wav.byteLength,
        },
        ctx.nowMs(),
      );

      if (!inserted) {
        // recordingId repetido: o cliente reenviou por retry após um
        // timeout de rede que já tinha, na verdade, funcionado.
        return reply.code(200).send({ ok: true, id: meta.recordingId, duplicate: true });
      }

      writeFileSync(wavPath, wav);
      notifyVoiceJobEnqueued();
      return reply.code(201).send({ ok: true, id: meta.recordingId });
    });

    voz.get("/status", async () => {
      return {
        available: Boolean(ctx.voiceDir),
        worker: getVoiceWorkerStatus(),
        queue: voiceQueueStats(ctx.db),
      };
    });

    voz.get<{ Querystring: { limit?: string } }>("/jobs", async (req) => {
      return { jobs: listVoiceJobs(ctx.db, req.query.limit ? Number(req.query.limit) : 20) };
    });

    voz.setErrorHandler((err, _req, reply) => {
      if (err instanceof ValidationError) {
        return reply.code(err.statusCode).send({ error: "VALIDATION_ERROR", message: err.message });
      }
      throw err;
    });
  }, { prefix: "/api/voz" });
}
