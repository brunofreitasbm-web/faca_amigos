import { app } from "electron";
import electronUpdater from "electron-updater";
import log from "electron-log";

const { autoUpdater } = electronUpdater;

/**
 * console.log não vai a lugar nenhum num app Electron empacotado (subsistema
 * Windows GUI, sem console anexado) — por isso nunca conseguimos saber, a
 * distância, por que o auto-update parava no quiosque. electron-log grava em
 * arquivo (%APPDATA%/FacaAmigos/logs/main.log) mesmo sem terminal.
 */
log.transports.file.level = "info";
log.transports.console.level = false;

let initialized = false;

/** Quiosque fica em fullscreen rodando por dias sem fechar — sem um
 * intervalo periódico, a única checagem é na abertura do app, então uma
 * atualização publicada nunca é vista até o próximo reboot manual. */
const PERIODIC_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Dispara uma verificação (e, se houver versão nova, download em segundo
 * plano). Chamado na abertura do app, periodicamente enquanto o app fica
 * aberto, e de novo antes de fechar — assim a atualização baixada fica
 * pronta e o autoInstallOnAppQuit instala no fechamento seguinte.
 */
export function checkForUpdates(): void {
  if (!app.isPackaged) return;
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.warn("[auto-updater] Falha ao verificar atualizações:", err);
  });
}

/**
 * Versão "aguardável" de checkForUpdates(), usada só no fechamento do app
 * (window-all-closed em main.ts).
 *
 * BUG que mantinha o quiosque preso na versão antiga mesmo abrindo e
 * fechando várias vezes: o handler antigo chamava checkForUpdates() (que
 * dispara checkForUpdatesAndNotify() sem aguardar) e, na sequência,
 * chamava app.quit() de forma síncrona — o processo morria antes do
 * download do instalador (~100 MB) terminar. Sem 'update-downloaded'
 * disparado, autoInstallOnAppQuit não tem o que instalar, e o download
 * parcial se perde a cada fechamento. Resultado: update nunca completa,
 * não importa quantas vezes o app é reaberto.
 *
 * Esta função aguarda a verificação (e o download, se houver uma versão
 * nova) terminar — via 'update-not-available', 'update-downloaded' ou
 * 'error' — antes de resolver, com um timeout de segurança para o
 * quiosque não travar fechando caso a rede esteja lenta/fora do ar.
 */
export function checkForUpdatesAndWait(timeoutMs = 5 * 60 * 1000): Promise<void> {
  if (!app.isPackaged) return Promise.resolve();

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
      log.warn("[auto-updater] Falha ao verificar/baixar atualização antes de fechar:", err);
      onSettle();
    };

    timer = setTimeout(() => {
      log.warn(`[auto-updater] Timeout de ${timeoutMs}ms aguardando atualização antes de fechar — prosseguindo com o fechamento.`);
      onSettle();
    }, timeoutMs);

    autoUpdater.once("update-not-available", onSettle);
    autoUpdater.once("update-downloaded", onSettle);
    autoUpdater.once("error", onError);

    void autoUpdater.checkForUpdates().catch(onError);
  });
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    log.info("[auto-updater] Ignorado em ambiente de desenvolvimento.");
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
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[auto-updater] Nova versão ${info.version} encontrada. Baixando em segundo plano...`);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[auto-updater] O aplicativo já está na versão mais recente.");
  });

  autoUpdater.on("download-progress", (progressObj) => {
    log.info(`[auto-updater] Download em andamento: ${Math.round(progressObj.percent)}% (${progressObj.bytesPerSecond} B/s)`);
  });

  autoUpdater.on("error", (err) => {
    log.warn("[auto-updater] Erro durante verificação de atualização:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`[auto-updater] Versão ${info.version} baixada e pronta para ser aplicada ao fechar o app.`);
  });

  // Verificação inicial na abertura do app (a de fechamento é disparada
  // por checkForUpdates() a partir do main.ts, no window-all-closed).
  checkForUpdates();

  setInterval(checkForUpdates, PERIODIC_CHECK_INTERVAL_MS);
}
