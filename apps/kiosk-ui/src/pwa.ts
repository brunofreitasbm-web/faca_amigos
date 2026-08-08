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

export function setupPwa(): void {
  if (isElectronLocal()) return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  // Import dinâmico: o módulo virtual só é resolvido quando necessário.
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
