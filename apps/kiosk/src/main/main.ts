import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "../server/app.js";
import { seedDevData } from "../server/seed-dev.js";
import { loadOrCreateTls } from "../server/tls.js";
import { startPrintBridge } from "./printBridge.js";
import { splashDataUrl } from "./splash.js";
import { startFiscalWorker } from "../fiscal/index.js";

/**
 * D1/D2 do plano: o Electron não fala com o banco diretamente — ele
 * sobe o mesmo servidor Fastify usado pelos tablets e carrega a UI a
 * partir dele. Isso garante que main (desktop) e tablets (LAN) rodam
 * exatamente o mesmo código de servidor e de SPA.
 */
const PORT = 7317;

// Uma única instância: reabrir o app deve focar a janela existente, não
// tentar subir um segundo servidor na mesma porta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** Build da SPA: extraResources no app empacotado; dist do workspace em dev. */
function resolveUiDist(): string {
  if (process.env.FACAAMIGOS_UI_DIST) return process.env.FACAAMIGOS_UI_DIST;
  if (app.isPackaged) return join(process.resourcesPath, "kiosk-ui");
  return join(import.meta.dirname, "../../../kiosk-ui/dist");
}

async function startLocalServer() {
  // Os .sql de migração viajam como extraResources no app empacotado —
  // ver electron-builder.yml e packages/db-local/src/migrate.ts.
  if (app.isPackaged && !process.env.FACAAMIGOS_MIGRATIONS_DIR) {
    process.env.FACAAMIGOS_MIGRATIONS_DIR = join(process.resourcesPath, "migrations");
  }

  const dbPath = process.env.FACAAMIGOS_DB_PATH ?? `${app.getPath("userData")}/facaamigos.db`;
  const db = openDatabase(dbPath);
  migrate(db);

  const nowMs = Date.now();
  if (process.env.FACAAMIGOS_SEED_DEV === "true") seedDevData(db, nowMs);

  const hmacKey = randomBytes(32).toString("hex");
  // Tablets da LAN precisam de HTTPS (câmera exige contexto seguro); o
  // próprio Electron carrega de 127.0.0.1 e pode continuar em HTTP.
  const tls = process.env.FACAAMIGOS_TLS === "true" ? loadOrCreateTls(`${app.getPath("userData")}/certs`) : undefined;
  const server = await buildApp({ db, hmacKey, nowMs: () => Date.now() }, { tls, uiDist: resolveUiDist() });
  await server.listen({ port: PORT, host: "0.0.0.0" });
  return tls;
}

function createWindow(protocol: "http" | "https", splash?: BrowserWindow) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#141414",
    webPreferences: { preload: `${import.meta.dirname}/preload.js`, contextIsolation: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => {
    splash?.close();
    win.show();
  });
  win.loadURL(`${protocol}://127.0.0.1:${PORT}`);
  return win;
}

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  // Splash imediata: migrate + TLS + fiscal levam alguns segundos e a
  // janela principal só aparece no ready-to-show da SPA.
  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#F0196B",
  });
  splash.loadURL(splashDataUrl);

  // Inicia junto com o Windows no terminal de loja (só no app instalado —
  // em dev isso registraria o binário do node_modules).
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

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

  createWindow(protocol, splash);
  startPrintBridge();

  // Emissão fiscal (Fase 3 do plano): try/catch explícito e captura de
  // rejeições não tratadas — um erro aqui NUNCA pode derrubar a impressão
  // de pulseira/cupom, que é o que trava o balcão na hora. O print bridge
  // acima não tem essa proteção porque foi escrito antes; o worker fiscal
  // não repete essa lacuna.
  try {
    startFiscalWorker(app.getPath("userData"));
  } catch (err) {
    console.error("[fiscal] falha ao iniciar o worker fiscal — emissão de NFC-e desligada neste terminal:", err);
  }
  process.on("unhandledRejection", (reason) => {
    console.error("[fiscal] rejeição não tratada no worker fiscal:", reason);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(protocol);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
