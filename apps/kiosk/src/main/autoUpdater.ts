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

/**
 * Dispara uma verificação (e, se houver versão nova, download em segundo
 * plano). Chamado na abertura do app e de novo antes de fechar — assim a
 * atualização baixada fica pronta e o autoInstallOnAppQuit instala no
 * fechamento seguinte, sem depender do intervalo de 4h que existia antes.
 */
export function checkForUpdates(): void {
  if (!app.isPackaged) return;
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.warn("[auto-updater] Falha ao verificar atualizações:", err);
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
}
