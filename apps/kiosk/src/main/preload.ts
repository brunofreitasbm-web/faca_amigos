// A SPA fala com o servidor local por HTTP/WS, não por IPC — esta é a
// única ponte: expõe a lista de impressoras instaladas no Windows deste
// terminal para a tela de Configurações validar o nome digitado contra o
// que o print bridge (rawPrint.ts/printBridge.ts) realmente vai usar.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("facaamigos", {
  listPrinters: () => ipcRenderer.invoke("list-printers") as Promise<{ name: string }[]>,
});
