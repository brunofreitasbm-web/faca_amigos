import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { cpus, setPriority, constants as osConstants } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { createClient } from "@supabase/supabase-js";
import log from "electron-log";
import {
  claimNextVoiceJob,
  getTerminalUnitId,
  listVoiceJobsWithWav,
  markVoiceJobFailed,
  markVoiceJobTranscribed,
  markVoiceJobUploaded,
  purgeUploadedVoiceJobs,
  resetStaleVoiceProcessing,
  type Db,
  type VoiceJobRow,
} from "@facaamigos/db-local";
import { resolveTerminalSupabaseKey } from "../config/supabaseTerminalKey.js";
import { onVoiceJobEnqueued, setVoiceWorkerStatus } from "./voiceWorkerControl.js";
import { buildWhisperArgs, maskPiiInTranscript, parseWhisperJson, whisperTimeoutMs } from "./voiceWorkerPolicy.js";

/**
 * Worker de transcrição local (whisper.cpp) das gravações de check-in/
 * check-out — mesmo raciocínio do print bridge e do worker fiscal
 * (apps/kiosk/src/main/printBridge.ts, apps/kiosk/src/fiscal/index.ts):
 * roda no processo main porque precisa de app.getPath("userData") e de
 * spawnar um processo nativo, coisas que src/server de propósito não tem
 * acesso (testes das rotas rodam sem Electron).
 *
 * O ÁUDIO NUNCA SAI DESTE COMPUTADOR: o whisper-cli transcreve localmente,
 * o WAV é apagado logo em seguida, e só o TEXTO (já com CPF/telefone
 * mascarados) sobe para fa_kiosk_voice_transcripts.
 */

const DEFAULT_MODEL = "ggml-small";
const POLL_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000; // 1x/hora: expurga UPLOADED antigos e WAVs órfãos
const UPLOADED_RETENTION_MS = 30 * 24 * 60 * 60_000; // 30 dias — só a linha do SQLite, o texto já está no Supabase
const MODEL_DOWNLOAD_RETRY_MS = 10 * 60_000;
const MODEL_MIN_BYTES = 50 * 1024 * 1024; // guarda contra download truncado/página de erro salva como .bin

function whisperCliPath(): string {
  if (process.env.FACAAMIGOS_WHISPER_CLI) return process.env.FACAAMIGOS_WHISPER_CLI;
  return app.isPackaged
    ? join(process.resourcesPath, "whisper", "whisper-cli.exe")
    : join(import.meta.dirname, "../../vendor/whisper/whisper-cli.exe");
}

function modelFileName(model: string): string {
  return model.endsWith(".bin") ? model : `${model}.bin`;
}

async function downloadModel(modelPath: string, modelName: string): Promise<void> {
  const partPath = `${modelPath}.part`;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFileName(modelName)}`;
  log.info(`[voz] baixando modelo whisper "${modelName}" de ${url}`);
  setVoiceWorkerStatus({ model: { name: modelName, state: "downloading", progressPct: 0 } });

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download do modelo falhou: HTTP ${res.status}`);

  const totalBytes = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastLoggedPct = -1;
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (totalBytes > 0) {
        const pct = Math.floor((received / totalBytes) * 100);
        if (pct >= lastLoggedPct + 5) {
          lastLoggedPct = pct;
          log.info(`[voz] modelo ${modelName}: ${pct}%`);
          setVoiceWorkerStatus({ model: { name: modelName, state: "downloading", progressPct: pct } });
        }
      }
    }
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.byteLength < MODEL_MIN_BYTES) {
    throw new Error(`download do modelo veio pequeno demais (${buffer.byteLength} bytes) — provável falha de rede`);
  }
  writeFileSync(partPath, buffer);
  await rename(partPath, modelPath);
  log.info(`[voz] modelo ${modelName} pronto (${(buffer.byteLength / 1_000_000).toFixed(0)} MB)`);
}

/** Garante que o modelo exista, baixando se preciso. Idempotente: chamadas concorrentes são evitadas pelo laço chamador (uma promise em voo por vez). */
async function ensureModel(userDataPath: string, modelName: string): Promise<string> {
  const dir = join(userDataPath, "whisper");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const modelPath = join(dir, modelFileName(modelName));

  if (existsSync(modelPath) && statSync(modelPath).size >= MODEL_MIN_BYTES) {
    setVoiceWorkerStatus({ model: { name: modelName, state: "ready" } });
    return modelPath;
  }

  try {
    await downloadModel(modelPath, modelName);
    setVoiceWorkerStatus({ model: { name: modelName, state: "ready" } });
    return modelPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[voz] modelo "${modelName}" indisponível: ${message}`);
    setVoiceWorkerStatus({ model: { name: modelName, state: "missing", error: message } });
    throw err;
  }
}

function transcribeWav(cli: string, args: string[], timeoutMs: number, pid?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { windowsHide: true });
    pid?.(child.pid ?? -1);
    try {
      // Prioridade abaixo do normal: transcrever não pode competir com o
      // caixa/impressão pelo processador do PC do balcão.
      if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // setPriority pode falhar sem privilégio suficiente — segue sem ela.
    }

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`whisper-cli não terminou em ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli saiu com código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export function startVoiceWorker(db: Db, userDataPath: string, deviceId: string | null | undefined, voiceDir: string): void {
  const { secretKey, hasServiceRoleKey } = resolveTerminalSupabaseKey();
  const url = process.env.FACAAMIGOS_SUPABASE_URL || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";
  const supabase = createClient(url, secretKey);

  setVoiceWorkerStatus({
    started: true,
    reason: hasServiceRoleKey ? undefined : "sem chave secreta configurada — transcrevendo e guardando local até a chave estar disponível",
    whisperCliFound: existsSync(whisperCliPath()),
    hasServiceRoleKey,
    model: { name: "", state: "missing" },
  });

  if (!existsSync(whisperCliPath())) {
    log.warn(`[voz] whisper-cli não encontrado em ${whisperCliPath()} — gravações ficarão em PENDING até o binário aparecer.`);
  }

  resetStaleVoiceProcessing(db, Date.now());

  let cachedModelPath: string | null = null;
  let modelPromise: Promise<string> | null = null;
  let lastModelFailureAtMs = 0;
  let cachedModelNameFromUnit: string | null = null;
  let modelNameCheckedAtMs = 0;
  let draining = false;

  /**
   * Nome do modelo: env var do terminal vence (override manual), senão o
   * que o gestor escolheu em Configurações > Gravação para a unidade deste
   * terminal (fa_kiosk_app_settings.voice_whisper_model), senão o padrão.
   * A unidade é lida do SQLite local (terminal_settings, já amarrado pelo
   * fluxo de Configurações > Impressoras > Este terminal); consultada de
   * novo a cada 5 min para acompanhar uma troca feita no Gerencial sem
   * precisar reiniciar o terminal.
   */
  async function currentModelName(): Promise<string> {
    if (process.env.FACAAMIGOS_WHISPER_MODEL) return process.env.FACAAMIGOS_WHISPER_MODEL;
    const nowMs = Date.now();
    if (cachedModelNameFromUnit && nowMs - modelNameCheckedAtMs < 5 * 60_000) return cachedModelNameFromUnit;
    modelNameCheckedAtMs = nowMs;
    try {
      const unitId = getTerminalUnitId(db);
      if (!unitId || !hasServiceRoleKey) return DEFAULT_MODEL;
      const { data } = await supabase.from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId).eq("key", "voice_whisper_model").maybeSingle();
      cachedModelNameFromUnit = data?.value?.trim() || DEFAULT_MODEL;
    } catch {
      cachedModelNameFromUnit = DEFAULT_MODEL;
    }
    return cachedModelNameFromUnit ?? DEFAULT_MODEL;
  }

  async function resolveModel(): Promise<string | null> {
    const name = await currentModelName();
    if (cachedModelPath?.includes(modelFileName(name))) return cachedModelPath;

    // Sem internet ou HuggingFace fora do ar: não martela o download a
    // cada job reivindicado (podem chegar a cada poucos segundos) — só
    // tenta de novo depois de MODEL_DOWNLOAD_RETRY_MS.
    if (Date.now() - lastModelFailureAtMs < MODEL_DOWNLOAD_RETRY_MS) return null;

    if (!modelPromise) {
      modelPromise = ensureModel(userDataPath, name)
        .then((p) => {
          cachedModelPath = p;
          return p;
        })
        .catch((err) => {
          lastModelFailureAtMs = Date.now();
          throw err;
        })
        .finally(() => {
          modelPromise = null;
        });
    }
    try {
      return await modelPromise;
    } catch {
      return null;
    }
  }

  async function transcribeOne(job: VoiceJobRow): Promise<void> {
    const cli = whisperCliPath();
    if (!existsSync(cli)) throw new Error("whisper-cli não encontrado neste terminal");
    const modelPath = await resolveModel();
    if (!modelPath) throw new Error("modelo whisper indisponível (ver log de download)");
    if (!job.wav_path || !existsSync(job.wav_path)) throw new Error("WAV não encontrado no disco (apagado antes da hora?)");

    const outBase = job.wav_path.replace(/\.wav$/i, "");
    const args = buildWhisperArgs({ modelPath, wavPath: job.wav_path, outBase, threads: Math.max(1, cpus().length - 2) });
    setVoiceWorkerStatus({ processingJobId: job.id });
    await transcribeWav(cli, args, whisperTimeoutMs(job.duration_ms));

    const jsonPath = `${outBase}.json`;
    const raw = existsSync(jsonPath) ? readFileSync(jsonPath, "utf-8") : "{}";
    const parsed = parseWhisperJson(raw);
    const text = maskPiiInTranscript(parsed.text);

    markVoiceJobTranscribed(
      db,
      job.id,
      { transcriptText: text, segmentsJson: JSON.stringify(parsed.segments), whisperModel: await currentModelName(), transcriptStatus: parsed.isEmpty ? "EMPTY" : "DONE" },
      Date.now(),
    );

    for (const p of [job.wav_path, jsonPath]) {
      try {
        if (p && existsSync(p)) unlinkSync(p);
      } catch (err) {
        log.warn(`[voz] falha ao apagar arquivo temporário ${p}:`, err);
      }
    }
  }

  async function uploadOne(job: VoiceJobRow): Promise<void> {
    if (!hasServiceRoleKey) throw new Error("sem chave secreta — aguardando configuração para subir ao Supabase");
    const { error } = await supabase.from("fa_kiosk_voice_transcripts").insert({
      id: job.id,
      unit_id: job.unit_id,
      employee_id: job.employee_id,
      session_ids: JSON.parse(job.session_ids_json || "[]"),
      order_id: job.order_id,
      momento: job.momento,
      outcome: job.outcome,
      started_at_ms: job.started_at_ms,
      ended_at_ms: job.ended_at_ms,
      duration_ms: job.duration_ms,
      terminal_id: deviceId ?? null,
      client_label: job.client_label,
      whisper_model: job.whisper_model ?? (await currentModelName()),
      worker_version: "1.0.0",
      transcript: job.transcript_text ?? "",
      segments: JSON.parse(job.segments_json || "[]"),
      status: job.transcript_status ?? "DONE",
    });
    // 23505 = unique_violation: já subiu antes (retry depois de um upload
    // que na verdade tinha funcionado) — trata como sucesso.
    if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
    markVoiceJobUploaded(db, job.id, job.id, Date.now());
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const nowMs = Date.now();
        const job = claimNextVoiceJob(db, nowMs, { allowTranscribe: true, allowUpload: true });
        if (!job) break;
        try {
          if (job.status === "PROCESSING") {
            await transcribeOne(job);
          } else if (job.status === "TRANSCRIBED") {
            await uploadOne(job);
          }
          setVoiceWorkerStatus({ processingJobId: undefined, lastError: undefined });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn(`[voz] job ${job.id} falhou:`, message);
          const finalStatus = markVoiceJobFailed(db, job.id, message, Date.now());
          setVoiceWorkerStatus({ processingJobId: undefined, lastError: message });
          if (finalStatus === "FAILED") {
            // Desistiu de vez: o WAV (se ainda existir) não serve mais de
            // nada e não pode ficar acumulando no disco do balcão.
            try {
              if (job.wav_path && existsSync(job.wav_path)) unlinkSync(job.wav_path);
            } catch {
              // best-effort
            }
          }
        }
      }
    } finally {
      draining = false;
    }
  }

  function cleanup(): void {
    try {
      const purged = purgeUploadedVoiceJobs(db, Date.now() - UPLOADED_RETENTION_MS);
      if (purged > 0) log.info(`[voz] expurgadas ${purged} linhas UPLOADED com mais de 30 dias do SQLite local`);

      // WAVs órfãos: arquivo no disco sem job "vivo" apontando pra ele
      // (job já terminou, ou o processo caiu entre gravar o arquivo e
      // inserir a linha). Nunca deixamos áudio > poucos dias no terminal.
      const inboxDir = join(voiceDir, "inbox");
      if (!existsSync(inboxDir)) return;
      const referenced = new Set(listVoiceJobsWithWav(db).map((j) => j.wav_path));
      for (const name of readdirSync(inboxDir)) {
        const full = join(inboxDir, name);
        if (referenced.has(full)) continue;
        const ageMs = Date.now() - statSync(full).mtimeMs;
        if (ageMs > 24 * 60 * 60_000) {
          try {
            unlinkSync(full);
            log.info(`[voz] apagado WAV órfão ${name} (${Math.round(ageMs / 3_600_000)}h sem job correspondente)`);
          } catch {
            // best-effort
          }
        }
      }
    } catch (err) {
      log.error("[voz] falha na limpeza periódica:", err);
    }
  }

  onVoiceJobEnqueued(() => void drain());
  const pollTimer = setInterval(() => void drain(), POLL_INTERVAL_MS);
  const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  pollTimer.unref?.();
  cleanupTimer.unref?.();

  void drain();
  void resolveModel();
}

