import { app, ipcMain, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import log from "electron-log";

function getAutoUpdater() {
  try {
    return electronUpdater.autoUpdater;
  } catch {
    return null;
  }
}

if (log?.transports) {
  log.transports.file.level = "info";
  log.transports.console.level = false;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloaded" | "error";
  version?: string;
  progress?: number;
  error?: string;
}

let currentUpdateState: UpdateState = {
  status: "idle",
  version: typeof app?.getVersion === "function" ? app.getVersion() : "dev",
};

let initialized = false;

const PERIODIC_CHECK_INTERVAL_MS = 15 * 60 * 1000;

// O quiosque fica ligado 24/7 — o autoInstallOnAppQuit sozinho nunca dispara
// porque o app não é fechado no dia a dia. Sem uma janela de instalação
// automática, a atualização baixada fica pendente para sempre e o terminal
// "congela" na versão antiga (foi exatamente o que prendeu a loja na 0.1.5).
// 03:30 é madrugada: loja fechada, nenhum check-in em andamento.
const IDLE_INSTALL_HOUR = 3;
const IDLE_INSTALL_MINUTE = 30;

let idleInstallTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextIdleWindow(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(IDLE_INSTALL_HOUR, IDLE_INSTALL_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleIdleInstall(version: string): void {
  if (idleInstallTimer) clearTimeout(idleInstallTimer);
  const delay = msUntilNextIdleWindow();
  log?.info?.(
    `[auto-updater] Instalação automática da versão ${version} agendada para daqui a ${Math.round(delay / 60000)} min (janela ociosa da madrugada).`,
  );
  idleInstallTimer = setTimeout(() => {
    log?.info?.(`[auto-updater] Janela ociosa atingida — aplicando a versão ${version} agora.`);
    applyUpdate();
  }, delay);
}

function notifyWindows(state: UpdateState): void {
  currentUpdateState = state;
  if (typeof BrowserWindow?.getAllWindows === "function") {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("update-status-change", state);
      }
    }
  }
}

export function getUpdateStatus(): UpdateState {
  return currentUpdateState;
}

export function applyUpdate(): void {
  const autoUpdater = getAutoUpdater();
  if (!app?.isPackaged || !autoUpdater) {
    log?.info?.("[auto-updater] Modo dev ou testes — simulação de applyUpdate.");
    return;
  }
  log?.info?.("[auto-updater] quitAndInstall acionado pelo usuário/sistema.");
  // isSilent: o terminal é um quiosque sem operador acompanhando — o NSIS
  // nunca pode abrir janela de instalador. isForceRunAfter: o app precisa
  // voltar sozinho depois da atualização (terminal sempre ligado).
  autoUpdater.quitAndInstall(true, true);
}

export function checkForUpdates(): void {
  const autoUpdater = getAutoUpdater();
  if (!app?.isPackaged || !autoUpdater) return;
  notifyWindows({ ...currentUpdateState, status: "checking" });
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log?.warn?.("[auto-updater] Falha ao verificar atualizações:", err);
    notifyWindows({
      ...currentUpdateState,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export function checkForUpdatesAndWait(timeoutMs = 5 * 60 * 1000): Promise<void> {
  const autoUpdater = getAutoUpdater();
  if (!app?.isPackaged || !autoUpdater) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      autoUpdater.off("update-not-available", onSettle);
      autoUpdater.off("update-downloaded", onSettle);
      autoUpdater.off("error", onError);
    };

    const onSettle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = (err: unknown) => {
      log?.warn?.("[auto-updater] Falha ao verificar/baixar atualização antes de fechar:", err);
      onSettle();
    };

    timer = setTimeout(() => {
      log?.warn?.(`[auto-updater] Timeout de ${timeoutMs}ms aguardando atualização antes de fechar — prosseguindo com o fechamento.`);
      onSettle();
    }, timeoutMs);

    autoUpdater.once("update-not-available", onSettle);
    autoUpdater.once("update-downloaded", onSettle);
    autoUpdater.once("error", onError);

    void autoUpdater.checkForUpdates().catch(onError);
  });
}

export function initAutoUpdater(): void {
  if (typeof ipcMain?.handle === "function") {
    ipcMain.handle("get-app-version", () => (app?.getVersion ? app.getVersion() : "0.1.6-dev"));
    ipcMain.handle("get-update-status", () => getUpdateStatus());
    ipcMain.handle("check-for-updates", () => {
      checkForUpdates();
      return getUpdateStatus();
    });
    ipcMain.handle("apply-update", () => {
      applyUpdate();
    });
  }

  const autoUpdater = getAutoUpdater();
  if (!app?.isPackaged || !autoUpdater) {
    log?.info?.("[auto-updater] Ignorado em ambiente de desenvolvimento ou teste.");
    return;
  }
  if (initialized) return;
  initialized = true;


  log.info(`[auto-updater] App versão atual: ${app.getVersion()} — log em: ${log.transports.file.getFile().path}`);

  const customFeedUrl = process.env.FACAAMIGOS_UPDATE_URL;
  if (customFeedUrl) {
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: customFeedUrl,
      });
      log.info(`[auto-updater] Feed de atualização configurado para: ${customFeedUrl}`);
    } catch (err) {
      log.warn("[auto-updater] Falha ao definir custom feed URL:", err);
    }
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // O feed é servido pelo CDN da Vercel, que não responde multipart/byteranges
  // — toda tentativa de download diferencial falhava com erro de Content-Type
  // e caía no download completo. Desliga direto e economiza o round-trip.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("[auto-updater] Verificando se existem novas atualizações...");
    notifyWindows({ ...currentUpdateState, status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[auto-updater] Nova versão ${info.version} encontrada. Baixando em segundo plano...`);
    notifyWindows({
      status: "available",
      version: info.version,
      progress: 0,
    });
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[auto-updater] O aplicativo já está na versão mais recente.");
    notifyWindows({
      status: "idle",
      version: app.getVersion(),
    });
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    log.info(`[auto-updater] Download em andamento: ${percent}% (${progressObj.bytesPerSecond} B/s)`);
    notifyWindows({
      ...currentUpdateState,
      status: "available",
      progress: percent,
    });
  });

  autoUpdater.on("error", (err) => {
    log.warn("[auto-updater] Erro durante verificação de atualização:", err);
    notifyWindows({
      ...currentUpdateState,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`[auto-updater] Versão ${info.version} baixada e pronta para ser aplicada.`);
    notifyWindows({
      status: "downloaded",
      version: info.version,
      progress: 100,
    });
    scheduleIdleInstall(info.version);
  });

  checkForUpdates();

  setInterval(checkForUpdates, PERIODIC_CHECK_INTERVAL_MS);
}

