import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
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
const WORKER_VERSION = "0.1.0-fase3-simulado";

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

export function startFiscalWorker(userDataPath: string): void {
  const url = process.env.FACAAMIGOS_SUPABASE_URL;
  const serviceRoleKey = process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.warn(
      "[fiscal] FACAAMIGOS_SUPABASE_URL / FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY não configurados — " +
        "emissão de NFC-e desligada neste terminal.",
    );
    return;
  }

  const simulado = process.env.FACAAMIGOS_FISCAL_MODE === "SIMULADO";
  const terminalId = loadOrCreateTerminalId(userDataPath);
  const log = (message: string) => console.log(message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, serviceRoleKey, { realtime: { transport: WebSocket as any } });

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

  log(`[fiscal] worker iniciado — terminal "${terminalId}", modo ${simulado ? "SIMULADO" : "REAL (Fase 5 pendente)"}.`);
}
