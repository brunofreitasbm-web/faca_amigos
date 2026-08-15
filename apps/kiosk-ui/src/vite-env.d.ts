/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Exposto pelo preload do Electron (apps/kiosk/src/main/preload.ts) só
// quando a SPA roda dentro do app desktop que tem o print bridge — não
// existe quando kiosk-ui abre num tablet comum da LAN.
interface Window {
  facaamigos?: {
    listPrinters: () => Promise<{ name: string }[]>;
  };
}
