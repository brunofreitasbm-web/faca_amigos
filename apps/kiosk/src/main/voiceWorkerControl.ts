/**
 * Ponto de encontro entre a rota HTTP que recebe a gravação de voz
 * (`POST /api/voz/recordings`) e o worker de transcrição, que roda no
 * processo main (mesmo raciocínio de printBridgeControl.ts).
 *
 * Existe como módulo próprio, sem importar `electron` nem
 * `@supabase/supabase-js`, para a rota não precisar arrastar o worker
 * inteiro (whisper.cpp, download de modelo) — e para o teste das rotas
 * rodar sem Electron.
 */

export interface VoiceModelStatus {
  name: string;
  state: "ready" | "downloading" | "missing" | "error";
  progressPct?: number;
  error?: string;
}

export interface VoiceWorkerStatus {
  started: boolean;
  reason?: string;
  whisperCliFound: boolean;
  model: VoiceModelStatus;
  hasServiceRoleKey: boolean;
  processingJobId?: string;
  lastError?: string;
  lastUploadedAtMs?: number;
}

type EnqueuedHandler = () => void;

let enqueuedHandler: EnqueuedHandler | null = null;
let status: VoiceWorkerStatus = {
  started: false,
  reason: "worker de voz não iniciado (fora do Electron, ou rota /api/voz chamada isolada em teste)",
  whisperCliFound: false,
  model: { name: "", state: "missing" },
  hasServiceRoleKey: false,
};

export function onVoiceJobEnqueued(fn: EnqueuedHandler | null): void {
  enqueuedHandler = fn;
}

/** Cutuca o worker para drenar a fila assim que uma gravação chega — sem esperar o próximo tick do polling. */
export function notifyVoiceJobEnqueued(): void {
  try {
    enqueuedHandler?.();
  } catch (err) {
    console.error("[voz] falha ao notificar o worker de um novo job:", err);
  }
}

export function setVoiceWorkerStatus(next: Partial<VoiceWorkerStatus>): void {
  status = { ...status, ...next };
}

export function getVoiceWorkerStatus(): VoiceWorkerStatus {
  return status;
}
