/**
 * Hooks de analytics do painel do responsável.
 *
 * O app não carrega gtag/GTM hoje (nenhum script de analytics existe no
 * index.html nem no kiosk-ui). Esta camada existe para que, no dia em que
 * um deles for colocado na página, os eventos já comecem a fluir sem
 * tocar em componente nenhum: se `window.gtag` ou `window.dataLayer`
 * aparecerem, o evento é enviado; se não, vira no-op silencioso (em dev,
 * um console.debug para dar visibilidade de que o hook disparou).
 */
type AnalyticsParams = Record<string, unknown>;

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: AnalyticsParams) => void;
    dataLayer?: AnalyticsParams[];
  }
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, params);
      return;
    }
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...params });
      return;
    }
    if (import.meta.env?.DEV) {
      console.debug("[analytics:no-op]", eventName, params);
    }
  } catch {
    // Analytics nunca pode derrubar a tela do cronômetro.
  }
}
