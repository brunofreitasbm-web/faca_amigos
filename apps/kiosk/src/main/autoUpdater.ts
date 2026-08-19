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
  version: app?.isPackaged && typeof app.getVersion === "function" ? app.getVersion() : "0.1.6-dev",
};

let initialized = false;

const PERIODIC_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

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
  autoUpdater.quitAndInstall(false, true);
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
  });

  checkForUpdates();

  setInterval(checkForUpdates, PERIODIC_CHECK_INTERVAL_MS);
}

