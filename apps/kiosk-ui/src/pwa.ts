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
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          void reg.unregister();
        }
        window.location.reload();
      }).catch(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  }
}

export function setupPwa(): void {
  if (isElectronLocal()) return;

  // Checagem proativa do arquivo version.json no servidor Vercel
  const checkVersionJson = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = (await res.json()) as { version?: string; buildSha?: string };
        const localVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
        const localSha = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "";
        if (data.version && (data.version !== localVersion || (data.buildSha && data.buildSha !== localSha))) {
          console.log(`[PWA AutoUpdate] Versão nova detectada (${data.version} / ${data.buildSha}). Forçando atualização...`);
          applyPwaUpdate();
        }
      }
    } catch {
      // Ignorar erros de conectividade transitórios
    }
  };

  // Checa 5s após abrir, depois a cada 1 minuto e em eventos de foco/online
  setTimeout(checkVersionJson, 5000);
  setInterval(checkVersionJson, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkVersionJson();
  });
  window.addEventListener("online", () => void checkVersionJson());

  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  // Import dinâmico: o módulo virtual só é resolvido quando necessário.
  void import("virtual:pwa-register").then(({ registerSW }) => {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateAvailable = true;
        updateListeners.forEach((fn) => fn(() => void applyPwaUpdate()));
        // Força o auto-reload automático após 1.5s do aviso visual
        setTimeout(() => {
          applyPwaUpdate();
        }, 1500);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        // Checar atualizações periodicamente (a cada 5 minutos)
        const INTERVAL_MS = 5 * 60 * 1000;
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


