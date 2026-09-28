import { encodeWav16kMono } from "./wavEncode.js";
import { Api } from "../api/client.js";

/**
 * Gravação de voz do balcão (check-in/check-out) para a base de
 * conhecimento de venda adicional — grava operador+cliente, converte para
 * WAV e envia para o servidor local do quiosque, que transcreve com
 * whisper.cpp e apaga o áudio (ver apps/kiosk/src/main/voiceWorker.ts).
 *
 * Singleton de propósito, fora do ciclo de vida de qualquer tela: uma
 * conversa de check-in pode atravessar várias sessões (irmãos) e o
 * checkout pode terminar num redirecionamento de página inteiro (Tap) —
 * um hook React morreria em ambos os casos. O estado vive em closure e
 * sobrevive à troca de tela; só logout/pagehide o encerram à força (ver
 * App.tsx).
 *
 * NUNCA envia nada por si: o gate em start() decide se a gravação está
 * ligada nesta unidade E se o servidor local responde — fora do kiosk
 * (SPA na Vercel, ou tablet sem /api) é sempre um no-op silencioso.
 */

export type VoiceMomento = "CHECKIN" | "CHECKOUT";
export type VoiceOutcome = "SUCCESS" | "ABANDONED" | "CAPPED";

export interface VoiceStartMeta {
  unitId: string;
  employeeId: string;
  momento: VoiceMomento;
}

export interface VoiceStopMeta {
  orderId?: string | null;
  outcome?: VoiceOutcome;
}

export interface VoiceRecorderPublicState {
  status: "idle" | "recording" | "unavailable";
  momento?: VoiceMomento;
  startedAtMs?: number;
}

const VOICE_RECORDING_DISABLED = true;

const MAX_DURATION_MS = 10 * 60_000;
const MIN_DURATION_MS = 4_000;
const MIN_BYTES = 8_000;
const GATE_CACHE_MS = 60_000;
const UPLOAD_RETRIES = [2_000, 6_000, 15_000];
const IDB_NAME = "facaamigos-voz";
const IDB_STORE = "pending";
const MAX_PENDING_ITEMS = 10;

interface RecordingSession {
  meta: VoiceStartMeta;
  recordingId: string;
  startedAtMs: number;
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  sessionIds: string[];
  capTimer: ReturnType<typeof setTimeout>;
}

interface PendingUpload {
  recordingId: string;
  meta: Record<string, unknown>;
  wav: ArrayBuffer;
}

type Listener = (state: VoiceRecorderPublicState) => void;

let current: RecordingSession | null = null;
const listeners = new Set<Listener>();
let publicState: VoiceRecorderPublicState = { status: "idle" };

// Cache do gate (setting da unidade + disponibilidade do /api local), para
// não bater no Supabase/servidor local a cada clique do operador.
let gateCache: { unitId: string; enabled: boolean; expiresAtMs: number } | null = null;
let availabilityCache: { available: boolean; expiresAtMs: number } | null = null;

function emit(): void {
  for (const l of listeners) l(publicState);
}

function setState(next: VoiceRecorderPublicState): void {
  publicState = next;
  emit();
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

/**
 * Ligada por padrão assim que este build chega ao terminal — não depende
 * de o gestor entrar em Configurações e marcar a caixinha em cada
 * unidade. Só some se alguém desligar explicitamente ('0'); ausência da
 * configuração (unidade nova, ou linha nunca gravada) e falha de rede
 * também contam como "ligada", porque a intenção é a gravação já nascer
 * ativa na atualização, não escondida atrás de um opt-in silencioso.
 */
async function isRecordingEnabled(unitId: string): Promise<boolean> {
  const nowMs = Date.now();
  if (gateCache && gateCache.unitId === unitId && gateCache.expiresAtMs > nowMs) return gateCache.enabled;
  let enabled = true;
  try {
    const row = await Api.unitSetting(unitId, "voice_recording_enabled");
    enabled = row?.value !== "0";
  } catch {
    enabled = true;
  }
  gateCache = { unitId, enabled, expiresAtMs: nowMs + GATE_CACHE_MS };
  return enabled;
}

async function isServerAvailable(): Promise<boolean> {
  const nowMs = Date.now();
  if (availabilityCache && availabilityCache.expiresAtMs > nowMs) return availabilityCache.available;
  const status = await Api.voiceStatus();
  const available = Boolean(status?.available);
  availabilityCache = { available, expiresAtMs: nowMs + GATE_CACHE_MS };
  return available;
}

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "recordingId" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function savePending(item: PendingUpload): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(item);
    const all = await new Promise<PendingUpload[]>((resolve) => {
      const getAll = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
      getAll.onsuccess = () => resolve(getAll.result as PendingUpload[]);
      getAll.onerror = () => resolve([]);
    });
    if (all.length > MAX_PENDING_ITEMS) {
      const oldest = all.sort((a, b) => (a.meta.startedAtMs as number) - (b.meta.startedAtMs as number))[0];
      if (oldest) db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(oldest.recordingId);
    }
  } catch (err) {
    console.warn("[voz] falha ao guardar gravação pendente localmente:", err);
  } finally {
    db.close();
  }
}

async function removePending(recordingId: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(recordingId);
  } finally {
    db.close();
  }
}

async function listPending(): Promise<PendingUpload[]> {
  const db = await openIdb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const getAll = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
      getAll.onsuccess = () => resolve(getAll.result as PendingUpload[]);
      getAll.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

async function postRecording(meta: Record<string, unknown>, wav: ArrayBuffer): Promise<boolean> {
  try {
    const res = await fetch("/api/voz/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Voz-Meta": JSON.stringify(meta) },
      body: wav,
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function uploadWithRetry(meta: Record<string, unknown>, wav: ArrayBuffer): Promise<void> {
  for (const delay of [0, ...UPLOAD_RETRIES]) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (await postRecording(meta, wav)) return;
  }
  // Sem rede/servidor após todas as tentativas: guarda para reenviar no
  // próximo start() ou quando a conexão voltar (ver flushPending).
  await savePending({ recordingId: meta.recordingId as string, meta, wav });
}

/** Reenvia gravações que ficaram pendentes por falha de rede — chamado no início de start() e em `online`. */
async function flushPending(): Promise<void> {
  const pending = await listPending();
  for (const item of pending) {
    if (await postRecording(item.meta, item.wav)) await removePending(item.recordingId);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushPending());
}

function newRecordingId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function finishAndSend(session: RecordingSession, stopMeta?: VoiceStopMeta): Promise<void> {
  clearTimeout(session.capTimer);
  session.stream.getTracks().forEach((t) => t.stop());
  const endedAtMs = Date.now();
  const durationMsRaw = endedAtMs - session.startedAtMs;

  if (durationMsRaw < MIN_DURATION_MS) return; // clique acidental — nem converte

  const blob = new Blob(session.chunks, { type: session.mediaRecorder.mimeType || "audio/webm" });
  if (blob.size < MIN_BYTES) return;

  try {
    const { wav, durationMs } = await encodeWav16kMono(blob);
    const meta = {
      recordingId: session.recordingId,
      unitId: session.meta.unitId,
      employeeId: session.meta.employeeId,
      momento: session.meta.momento,
      startedAtMs: session.startedAtMs,
      endedAtMs,
      durationMs,
      sessionIds: session.sessionIds,
      orderId: stopMeta?.orderId ?? undefined,
      outcome: stopMeta?.outcome ?? "SUCCESS",
      clientLabel: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : undefined,
    };
    await uploadWithRetry(meta, wav);
  } catch (err) {
    console.warn("[voz] falha ao converter/enviar a gravação:", err);
  }
}

async function stopInternal(stopMeta?: VoiceStopMeta, wait = false): Promise<void> {
  const session = current;
  if (!session) return;
  current = null;
  setState({ status: "idle" });

  const donePromise = new Promise<void>((resolve) => {
    session.mediaRecorder.addEventListener(
      "stop",
      () => {
        void finishAndSend(session, stopMeta).finally(resolve);
      },
      { once: true },
    );
  });

  if (session.mediaRecorder.state !== "inactive") session.mediaRecorder.stop();
  else void finishAndSend(session, stopMeta);

  if (wait) await donePromise;
}

export const voiceRecorder = {
  isActive(): boolean {
    return current !== null;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(publicState);
    return () => listeners.delete(listener);
  },

  /** Inicia (ou é no-op se já ativo no mesmo momento). Se ativo num momento diferente, fecha o anterior como ABANDONED antes. */
  async start(meta: VoiceStartMeta): Promise<void> {
    // Função de gravação/transcrição de voz desativada em toda a rede —
    // não pede microfone nem chama o servidor local. Ver também o gate
    // server-side (ctx.voiceDir) em apps/kiosk/src/server/start.ts e
    // apps/kiosk/src/main/main.ts.
    if (VOICE_RECORDING_DISABLED) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;

    if (current) {
      if (current.meta.momento === meta.momento && current.meta.unitId === meta.unitId) return; // já gravando esta conversa
      await stopInternal({ outcome: "ABANDONED" });
    }

    void flushPending();

    const [enabled, available] = await Promise.all([isRecordingEnabled(meta.unitId), isServerAvailable()]);
    if (!enabled || !available) {
      setState({ status: "unavailable" });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      console.info("[voz] microfone indisponível, gravação desligada nesta sessão:", err instanceof Error ? err.message : err);
      setState({ status: "unavailable" });
      return;
    }

    const mimeType = pickMimeType();
    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });

    const startedAtMs = Date.now();
    const session: RecordingSession = {
      meta,
      recordingId: newRecordingId(),
      startedAtMs,
      mediaRecorder,
      stream,
      chunks,
      sessionIds: [],
      capTimer: setTimeout(() => void stopInternal({ outcome: "CAPPED" }), MAX_DURATION_MS),
    };
    current = session;
    mediaRecorder.start(1000);
    setState({ status: "recording", momento: meta.momento, startedAtMs });
  },

  /** Acrescenta uma sessão à conversa em andamento (irmãos no check-in, várias sessões num checkout). No-op se nada estiver gravando. */
  addSession(sessionId: string): void {
    if (current && !current.sessionIds.includes(sessionId)) current.sessionIds.push(sessionId);
  },

  /** Para, converte e envia — não bloqueia quem chama a menos que `wait: true` (necessário antes de um redirecionamento de página, ex. Tap). */
  async stop(meta?: VoiceStopMeta & { wait?: boolean }): Promise<void> {
    await stopInternal(meta, meta?.wait);
  },

  /** Para sem enviar nada (ex.: pagehide — não há tempo de converter+enviar). */
  discard(): void {
    if (!current) return;
    const session = current;
    current = null;
    setState({ status: "idle" });
    clearTimeout(session.capTimer);
    if (session.mediaRecorder.state !== "inactive") session.mediaRecorder.stop();
    session.stream.getTracks().forEach((t) => t.stop());
  },
};
