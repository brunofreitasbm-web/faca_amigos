/**
 * PWA: registro do service worker COM GUARDA de origem.
 *
 * A mesma build roda em dois lugares: no Electron (http://127.0.0.1:7317,
 * servida pelo Fastify local) e na Vercel (HTTPS), que é o que os
 * celulares/tablets instalam. 127.0.0.1 também é secure context — sem a
 * guarda, o SW se instalaria no desktop e poderia congelar uma shell
 * antiga do precache após um update do app. Aqui o SW só registra fora
 * do ambiente local.
 */
export function isElectronLocal(): boolean {
  return (
    /Electron/i.test(navigator.userAgent) || ["127.0.0.1", "localhost"].includes(window.location.hostname)
  );
}

/** True quando aberto pelo ícone da tela inicial (modo app instalado). */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type UpdateListener = (updateFn: () => void) => void;
const updateListeners = new Set<UpdateListener>();

let updateAvailable = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function subscribePwaUpdate(listener: UpdateListener): () => void {
  updateListeners.add(listener);
  if (updateAvailable && updateSW) {
    listener(() => void applyPwaUpdate());
  }
  return () => {
    updateListeners.delete(listener);
  };
}

export function applyPwaUpdate(): void {
  if (updateSW) {
    void updateSW(true);
  } else {
    window.location.reload();
  }
}

export function setupPwa(): void {
  if (isElectronLocal()) return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  // Import dinâmico: o módulo virtual só é resolvido quando necessário.
  void import("virtual:pwa-register").then(({ registerSW }) => {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateAvailable = true;
        updateListeners.forEach((fn) => fn(() => void applyPwaUpdate()));
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        // Checar atualizações periodicamente (a cada 15 minutos)
        const INTERVAL_MS = 15 * 60 * 1000;
        setInterval(() => {
          if (navigator.onLine) {
            void registration.update();
          }
        }, INTERVAL_MS);

        // Checar quando a tela ganha foco ou quando a internet reconecta
        const checkUpdate = () => {
          if (document.visibilityState === "visible" && navigator.onLine) {
            void registration.update();
          }
        };

        document.addEventListener("visibilitychange", checkUpdate);
        window.addEventListener("online", checkUpdate);
      },
    });
  });
}

