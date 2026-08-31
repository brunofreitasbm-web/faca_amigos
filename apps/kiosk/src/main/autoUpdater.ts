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

// O terminal NÃO fica ligado 24/7 — a loja liga o PC por volta das 10h e
// desliga por volta das 22h (energia cortada, não um "Desligar" do Windows
// com tempo de sobra). Uma janela de instalação fixa de madrugada (versão
// antiga desta lógica, 03:30) nunca chega a rodar: o processo já está morto
// a essa hora todo santo dia, e a atualização baixada ficava pendente para
// sempre — o terminal "congelava" na versão antiga (foi o que prendeu a loja
// na 0.1.5, e de novo aqui: nenhum terminal saiu da 0.1.21 sozinho).
//
// A única janela ociosa real é a abertura do dia: os primeiros minutos após
// o boot, antes de qualquer check-in. Por isso, se a atualização já estava
// baixada de um dia anterior (ou termina de baixar) dentro desse período
// logo após o app subir, instala na hora — quitAndInstall(true, true) fecha,
// instala em silêncio e o próprio instalador reabre o app, então a loja só
// vê o terminal demorar um pouco mais para aparecer na tela de login.
// Fora dessa janela (baixou no meio do expediente), não força: fica
// pendente para o fechamento do terminal (window-all-closed, main.ts) ou,
// na pior hipótese, para a abertura do dia seguinte.
const STARTUP_INSTALL_GRACE_MS = 5 * 60 * 1000;
const appStartMs = Date.now();

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
    ipcMain.handle("get-app-version", () => (app?.getVersion ? app.getVersion() : "0.1.13-dev"));
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

    if (Date.now() - appStartMs < STARTUP_INSTALL_GRACE_MS) {
      log.info(`[auto-updater] Baixada logo na abertura do terminal — aplicando a versão ${info.version} agora, antes do expediente.`);
      applyUpdate();
    } else {
      log.info(
        `[auto-updater] Versão ${info.version} baixada durante o expediente — não instala agora para não interromper um atendimento. Fica pendente para o fechamento do terminal ou a próxima abertura.`,
      );
    }
  });

  checkForUpdates();

  setInterval(checkForUpdates, PERIODIC_CHECK_INTERVAL_MS);
}

