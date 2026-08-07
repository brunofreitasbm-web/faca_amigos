import { randomBytes } from "node:crypto";
import { app, BrowserWindow } from "electron";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "../server/app.js";
import { seedDevData } from "../server/seed-dev.js";
import { loadOrCreateTls } from "../server/tls.js";
import { startPrintBridge } from "./printBridge.js";

/**
 * D1/D2 do plano: o Electron não fala com o banco diretamente — ele
 * sobe o mesmo servidor Fastify usado pelos tablets e carrega a UI a
 * partir dele. Isso garante que main (desktop) e tablets (LAN) rodam
 * exatamente o mesmo código de servidor e de SPA.
 *
 * Não verificado em execução real nesta sessão (ambiente sem display).
 * TLS autoassinado, empacotamento NSIS e o teste "instalar numa
 * segunda máquina" continuam como critério de aceite da Fase 0 (seção
 * 11 do plano), ainda pendentes.
 */
const PORT = 7317;

async function startLocalServer() {
  const dbPath = process.env.FACAAMIGOS_DB_PATH ?? `${app.getPath("userData")}/facaamigos.db`;
  const db = openDatabase(dbPath);
  migrate(db);

  const nowMs = Date.now();
  if (process.env.FACAAMIGOS_SEED_DEV === "true") seedDevData(db, nowMs);

  const hmacKey = randomBytes(32).toString("hex");
  // Tablets da LAN precisam de HTTPS (câmera exige contexto seguro); o
  // próprio Electron carrega de 127.0.0.1 e pode continuar em HTTP.
  const tls = process.env.FACAAMIGOS_TLS === "true" ? loadOrCreateTls(`${app.getPath("userData")}/certs`) : undefined;
  const server = await buildApp({ db, hmacKey, nowMs: () => Date.now() }, { tls });
  await server.listen({ port: PORT, host: "0.0.0.0" });
  return tls;
}

function createWindow(protocol: "http" | "https") {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { preload: `${import.meta.dirname}/preload.js`, contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`${protocol}://127.0.0.1:${PORT}`);
}

app.whenReady().then(async () => {
  const tls = await startLocalServer();
  const protocol = tls ? "https" : "http";

  // O certificado é o mesmo que acabamos de gerar/carregar em disco —
  // confiar nele aqui é aceitável porque a origem é local, não terceira.
  if (tls) {
    app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
      if (url.startsWith(`https://127.0.0.1:${PORT}`)) {
        event.preventDefault();
        callback(true);
      } else {
        callback(false);
      }
    });
  }

  createWindow(protocol);
  startPrintBridge();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(protocol);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
