import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, Menu, ipcMain, dialog } from "electron";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "../server/app.js";
import { seedDevData } from "../server/seed-dev.js";
import { loadOrCreateTls } from "../server/tls.js";
import { startPrintBridge } from "./printBridge.js";
import { splashDataUrl } from "./splash.js";
import { startFiscalWorker } from "../fiscal/index.js";

/**
 * O bundle é puro esbuild sem `dotenv` — sem isto, `apps/kiosk/.env`
 * (FACAAMIGOS_SUPABASE_URL/SERVICE_ROLE_KEY/PUBLIC_APP_URL) fica só um
 * arquivo no disco que ninguém lê: o print bridge via `process.env` direto,
 * então a ponte de impressão "desligava silenciosamente" mesmo com o .env
 * preenchido. Variáveis já definidas no ambiente real (produção) não são
 * sobrescritas.
 */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(join(import.meta.dirname, "../.env"));

/**
 * D1/D2 do plano: o Electron não fala com o banco diretamente — ele
 * sobe o mesmo servidor Fastify usado pelos tablets e carrega a UI a
 * partir dele. Isso garante que main (desktop) e tablets (LAN) rodam
 * exatamente o mesmo código de servidor e de SPA.
 */
const PORT = 7317;

// Uma única instância: reabrir o app deve focar a janela existente, não
// tentar subir um segundo servidor na mesma porta. app.quit() não interrompe
// a execução do resto deste módulo, então o guard abaixo evita que uma
// segunda instância tente registrar handlers e ouvir a mesma porta.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
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

if (isPrimaryInstance) {
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

    // Sem isso, qualquer falha em startLocalServer/createWindow (porta
    // ocupada, migração quebrada, TLS sem permissão de escrita) virava uma
    // unhandledRejection silenciosa e a splash "Iniciando o sistema..."
    // ficava travada para sempre, sem nenhum aviso pro usuário.
    let tls: Awaited<ReturnType<typeof startLocalServer>>;
    try {
      tls = await startLocalServer();
    } catch (err) {
      console.error("[main] falha ao iniciar o servidor local:", err);
      dialog.showErrorBox(
        "Falha ao iniciar o sistema",
        `Não foi possível iniciar o FaçaAmigos.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      splash.close();
      app.quit();
      return;
    }
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

    const mainWindow = createWindow(protocol, splash);

    // Sem isto, a ponte de impressão falhava só com um console.warn: o
    // terminal parecia funcionar normalmente, mas nenhuma pulseira/recibo
    // saía e ninguém no balcão descobria até a família já ter ido embora.
    const printBridgeResult = startPrintBridge();
    if (!printBridgeResult.started) {
      dialog.showMessageBox({
        type: "warning",
        title: "Impressão automática desligada",
        message: "A impressão automática de pulseira/recibo está desligada neste terminal.",
        detail: `${printBridgeResult.reason}\n\nOs check-ins continuam funcionando normalmente, mas nada será impresso até isso ser corrigido e o app reiniciado.`,
        buttons: ["OK"],
      });
    }

    // Fonte da verdade para a tela Configurações > Impressoras validar o
    // nome digitado: o print bridge usa esse mesmo nome literal em
    // OpenPrinterA/webContents.print, então um typo aqui é impressão
    // silenciosamente falhando sem nada na fila do Windows.
    ipcMain.handle("list-printers", async () => {
      try {
        return await mainWindow.webContents.getPrintersAsync();
      } catch (err) {
        console.error("[main] falha ao listar impressoras instaladas:", err);
        return [];
      }
    });

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
}
