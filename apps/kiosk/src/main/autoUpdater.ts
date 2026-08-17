import { app } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

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
    console.warn("[auto-updater] Falha ao verificar atualizações:", err);
  });
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log("[auto-updater] Ignorado em ambiente de desenvolvimento.");
    return;
  }
  if (initialized) return;
  initialized = true;

  const customFeedUrl = process.env.FACAAMIGOS_UPDATE_URL;
  if (customFeedUrl) {
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: customFeedUrl,
      });
      console.log(`[auto-updater] Feed de atualização configurado para: ${customFeedUrl}`);
    } catch (err) {
      console.warn("[auto-updater] Falha ao definir custom feed URL:", err);
    }
  }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-updater] Verificando se existem novas atualizações...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[auto-updater] Nova versão ${info.version} encontrada. Baixando em segundo plano...`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-updater] O aplicativo já está na versão mais recente.");
  });

  autoUpdater.on("download-progress", (progressObj) => {
    console.log(`[auto-updater] Download em andamento: ${Math.round(progressObj.percent)}% (${progressObj.bytesPerSecond} B/s)`);
  });

  autoUpdater.on("error", (err) => {
    console.warn("[auto-updater] Erro durante verificação de atualização:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[auto-updater] Versão ${info.version} baixada e pronta para ser aplicada ao fechar o app.`);
  });

  // Verificação inicial na abertura do app (a de fechamento é disparada
  // por checkForUpdates() a partir do main.ts, no window-all-closed).
  checkForUpdates();
}
