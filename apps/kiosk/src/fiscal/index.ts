import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { resolveTerminalSupabaseKey } from "../config/supabaseTerminalKey.js";
import { electronSafeStorageCrypto } from "./electron-crypto.js";
import { runFiscalClaimOnce } from "./claim.js";
import { startFiscalHeartbeatLoop } from "./heartbeat.js";

/**
 * Worker fiscal (Fase 3 do plano) — segundo assinante Realtime no mesmo
 * processo do print bridge (apps/kiosk/src/main/printBridge.ts), mesma
 * `service_role` key, mesmo padrão de catch-up no boot + assinatura +
 * polling de reforço.
 *
 * Chamado a partir de main.ts DENTRO de um try/catch: um erro aqui nunca
 * pode derrubar a impressão de pulseira, que é o que trava o balcão na
 * hora. Ver a nota em main.ts.
 */

const POLL_INTERVAL_MS = 30_000;
const WORKER_VERSION = "0.2.0-real";

function terminalIdPath(userDataPath: string): string {
  return join(userDataPath, "fiscal", "terminal-id.txt");
}

/** Um id de terminal estável entre reinícios — persistido em disco na primeira execução. */
function loadOrCreateTerminalId(userDataPath: string): string {
  const filePath = terminalIdPath(userDataPath);
  if (existsSync(filePath)) return readFileSync(filePath, "utf-8").trim();

  const dir = join(userDataPath, "fiscal");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = `${hostname()}-${randomUUID().slice(0, 8)}`;
  writeFileSync(filePath, id, "utf-8");
  return id;
}

export function startFiscalWorker(userDataPath: string, deviceId?: string | null): void {
  const url = process.env.FACAAMIGOS_SUPABASE_URL || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";
  // Mesma guarda do print bridge (main/printBridge.ts), via helper
  // compartilhado: sem uma chave secreta real (ou com a publicável colada
  // por engano em FACAAMIGOS_SUPABASE_SECRET_KEY, como já aconteceu em
  // produção), o fallback cairia numa chave que a Edge Function
  // `nfse-certificate-fetch` SEMPRE rejeita com "não autorizado" — um erro
  // que parece problema no certificado mas na verdade é .env deste terminal.
  const { secretKey, canFetchFiscalCredentials, kind } = resolveTerminalSupabaseKey();

  if (!url || !secretKey) {
    console.warn(
      "[fiscal] FACAAMIGOS_SUPABASE_URL / FACAAMIGOS_SUPABASE_SECRET_KEY não configurados — " +
        "emissão de NFC-e desligada neste terminal.",
    );
    return;
  }

  // Só a chave nova (`sb_secret_...`) autoriza em `nfse-certificate-fetch`.
  // Subir o worker com qualquer outra coisa não emite nota nenhuma: ele
  // reivindica o documento da fila, leva 401 ao buscar o certificado e
  // grava BLOQUEADO "não autorizado" — e, pior, tira o documento de um
  // terminal vizinho que estava configurado certo (a fila usa
  // `for update skip locked`, então quem chega primeiro leva). Ficar de
  // fora da fila é melhor que participar dela quebrado.
  if (!canFetchFiscalCredentials) {
    const motivo =
      kind === "publishable" || kind === "none"
        ? "a chave configurada é a PUBLICÁVEL (ou não há chave nenhuma)"
        : "a service_role LEGADA (eyJ...) não é mais aceita pela Edge Function de certificado";
    console.warn(
      `[fiscal] emissão de NFC-e/NFS-e desligada neste terminal: ${motivo}. ` +
        "Cole a chave secreta nova (sb_secret_..., em Supabase > Project Settings > API Keys > Secret keys) " +
        "em FACAAMIGOS_SUPABASE_SECRET_KEY no .env deste terminal (%APPDATA%\\FacaAmigos\\.env) e reinicie. " +
        "Ver apps/kiosk/.env.example.",
    );
    return;
  }

  const simulado = process.env.FACAAMIGOS_FISCAL_MODE === "SIMULADO";
  const terminalId = loadOrCreateTerminalId(userDataPath);
  const log = (message: string) => console.log(message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, secretKey, { realtime: { transport: WebSocket as any } });

  let processing = false;
  async function drainQueue(): Promise<void> {
    if (processing) return; // evita duas passadas concorrentes no mesmo terminal
    processing = true;
    try {
      let claimed: number;
      do {
        claimed = await runFiscalClaimOnce(
          {
            supabase,
            terminalId,
            deviceId,
            simulado,
            userDataPath,
            crypto: electronSafeStorageCrypto(),
            onLog: log,
          },
          5,
        );
      } while (claimed > 0);
    } finally {
      processing = false;
    }
  }

  // Catch-up: pega documentos que chegaram antes deste terminal ligar (o
  // PC estava desligado, por exemplo) — a assinatura Realtime abaixo só
  // reage a eventos futuros, não a histórico.
  void drainQueue();

  // Realtime: reage assim que uma venda enfileira um documento novo.
  supabase
    .channel("fa_kiosk_fiscal_docs_worker")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "fa_kiosk_fiscal_docs" }, () => {
      void drainQueue();
    })
    .subscribe((status) => {
      log(`[fiscal] canal Realtime: ${status}`);
    });

  // Polling de reforço: cobre o caso raro de um evento Realtime perdido —
  // mesma mitigação M1/M3 do plano (fila durável + heartbeat).
  setInterval(() => void drainQueue(), POLL_INTERVAL_MS);

  startFiscalHeartbeatLoop({
    supabase,
    terminalId,
    userDataPath,
    crypto: electronSafeStorageCrypto(),
    workerVersion: WORKER_VERSION,
    onLog: log,
  });

  log(`[fiscal] worker iniciado — terminal "${terminalId}", modo ${simulado ? "SIMULADO" : "REAL"}.`);
}
