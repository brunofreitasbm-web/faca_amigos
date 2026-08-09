/**
 * Web Push — inscrição do navegador do responsável para receber o alerta
 * mesmo com o app fechado/em segundo plano (ver AcompanharScreen). Chave
 * pública VAPID: não é segredo, o par correspondente (privado) mora só na
 * edge function push-alert-dispatch.
 */
const VAPID_PUBLIC_KEY = "BJhjx5DI70O6oFStbFYAlrCWwMmrg098IfyJh2CVsbQsAc-4WTRCAvo4TDNbem3xCk4IhxDMYSiJNNGCD_7KYnY";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

/**
 * Push real exige: contexto seguro + Service Worker + PushManager. Falta em
 * dois casos comuns aqui — Electron local (pwa.ts nunca registra SW lá) e
 * Safari/iOS fora do modo instalado (Apple só libera Web Push para PWA
 * adicionado à Tela de Início, mesmo no iOS 16.4+).
 */
export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}

/** Reaproveita inscrição existente ou cria uma nova — nunca duplica no navegador. */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });
}

export function pushSubscriptionToKeys(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}
