/**
 * Retorna a URL pública base da aplicação web.
 *
 * Ordem de resolução:
 * 1. `VITE_PUBLIC_APP_URL` (se definida no ambiente de build).
 * 2. `window.location.origin` (se a aplicação estiver rodando num domínio não-local, ex.: Vercel em produção).
 * 3. Fallback padrão: `"https://kiosk-ui.vercel.app"` (garante que QR codes de pareamento móvel,
 *    links de cadastro e acompanhamento funcionem imediatamente no Electron/localhost local).
 */
export const DEFAULT_PUBLIC_APP_URL = "https://kiosk-ui.vercel.app";

export function getPublicAppUrl(): string {
  const envUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim();
  }

  if (typeof window !== "undefined" && window.location) {
    const isLocalOrigin = ["127.0.0.1", "localhost"].includes(window.location.hostname);
    if (!isLocalOrigin && window.location.origin && window.location.origin !== "null") {
      return window.location.origin;
    }
  }

  return DEFAULT_PUBLIC_APP_URL;
}
