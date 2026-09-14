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

/**
 * Grava `last_error` em `fa_kiosk_fiscal_terminal_status` para cada unidade
 * fiscal-habilitada, usando uma chave que ainda tem acesso de escrita ao
 * banco (service_role legada) mesmo quando o worker está desligado por não
 * poder chamar a Edge Function de certificado. Best-effort: se isto falhar,
 * o único efeito é a mensagem continuar restrita ao console do terminal.
 */
async function reportWorkerDisabled(
  url: string,
  secretKey: string,
  terminalId: string,
  motivo: string,
): Promise<void> {
  try {
    const client = createClient(url, secretKey);
    const { data: units } = await client.from("fa_kiosk_units").select("id").eq("fiscal_enabled", true);
    if (!units || units.length === 0) return;
    const nowMs = Date.now();
    await client.from("fa_kiosk_fiscal_terminal_status").upsert(
      (units as Array<{ id: string }>).map((unit) => ({
        unit_id: unit.id,
        terminal_id: terminalId,
        last_heartbeat_ms: nowMs,
        last_error: motivo,
      })),
      { onConflict: "unit_id" },
    );
  } catch {
    // best-effort — ver comentário acima.
  }
}

export function startFiscalWorker(userDataPath: string, deviceId?: string | null): void {
  const url = process.env.FACAAMIGOS_SUPABASE_URL || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";
  // Mesma guarda do print bridge (main/printBridge.ts), via helper
  // compartilhado: sem uma chave secreta real (ou com a publicável colada
  // por engano em FACAAMIGOS_SUPABASE_SECRET_KEY, como já aconteceu em
  // produção), o fallback cairia numa chave que a Edge Function
  // `nfse-certificate-fetch` SEMPRE rejeita com "não autorizado" — um erro
  // que parece problema no certificado mas na verdade é .env deste terminal.
  const { secretKey, canFetchFiscalCredentials, hasServiceRoleKey, kind } = resolveTerminalSupabaseKey();
  const terminalId = loadOrCreateTerminalId(userDataPath);

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
    const mensagem =
      `[fiscal] emissão de NFC-e/NFS-e desligada neste terminal: ${motivo}. ` +
      "Cole a chave secreta nova (sb_secret_..., em Supabase > Project Settings > API Keys > Secret keys) " +
      "em FACAAMIGOS_SUPABASE_SECRET_KEY no .env deste terminal (%APPDATA%\\FacaAmigos\\.env) e reinicie. " +
      "Ver apps/kiosk/.env.example.";
    console.warn(mensagem);

    // O console do Electron não é visto por ninguém no balcão. Uma chave
    // legada (eyJ...) ainda grava no banco mesmo sem poder chamar a Edge
    // Function — usamos essa brecha para deixar o motivo visível em
    // Configurações (fa_kiosk_fiscal_terminal_status.last_error) em vez de
    // a fila só ficar acumulando PENDENTE sem nenhum sinal em lugar nenhum.
    if (hasServiceRoleKey) {
      void reportWorkerDisabled(url, secretKey, terminalId, mensagem);
    }
    return;
  }

  const simulado = process.env.FACAAMIGOS_FISCAL_MODE === "SIMULADO";
  const log = (message: string) => console.log(message);

  // O `Authorization` explícito NÃO é redundante — é o que faz a emissão
  // fiscal funcionar. Em @supabase/supabase-js 2.112.1, `functions.invoke`
  // manda `apikey: <secretKey>` mas monta o bearer a partir da sessão do
  // usuário, que num worker headless não existe; o header sai literalmente
  // como `Authorization: undefined`. A Edge Function tira o "Bearer ",
  // compara "undefined" com o segredo e responde 401 — que chegava ao
  // painel como "Certificado A1 não disponível: não autorizado".
  //
  // Medido nesta máquina em 2026-09-02, mesma chave nos dois casos:
  //   fetch cru + Authorization    -> 200
  //   supabase.functions.invoke    -> 401  (authorization: "undefined")
  //
  // Ver o teste de regressão em test/fiscal-certificado.spec.ts.
  const supabase = createClient(url, secretKey, {
    global: { headers: { Authorization: `Bearer ${secretKey}` } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: WebSocket as any },
  });

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
