import { app } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log("[auto-updater] Ignorado em ambiente de desenvolvimento.");
    return;
  }

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

  // Executa uma verificação inicial e depois a cada 4 horas
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn("[auto-updater] Falha ao verificar atualizações:", err);
  });

  setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn("[auto-updater] Falha periódica ao verificar atualizações:", err);
    });
  }, 4 * 60 * 60 * 1000);
}
