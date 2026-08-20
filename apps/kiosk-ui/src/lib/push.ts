/**
 * Web Push — inscrição do navegador do responsável para receber o alerta
 * mesmo com o app fechado/em segundo plano (ver AcompanharScreen). Chave
 * pública VAPID: não é segredo, o par correspondente (privado) mora só na
 * edge function push-alert-dispatch.
 */
const VAPID_PUBLIC_KEY = "BJhjx5DI70O6oFStbFYAlrCWwMmrg098IfyJh2CVsbQsAc-4WTRCAvo4TDNbem3xCk4IhxDMYSiJNNGCD_7KYnY";

export const OWNER_PUSH_STORAGE_KEY = "fa_owner_push_enabled";

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

/** Retorna inscrição Web Push existente caso o navegador já possua uma ativa. */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Reaproveita inscrição existente ou cria uma nova — nunca duplica no navegador. */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  if ("Notification" in window) {
    if (Notification.permission === "denied") {
      throw new Error("As notificações estão bloqueadas nas configurações do seu navegador/dispositivo.");
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Permissão para enviar notificações não foi concedida.");
      }
    }
  }
  const existing = await getExistingPushSubscription();
  if (existing) return existing;
  const registration = await navigator.serviceWorker.ready;
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

/**
 * Garante que se o Owner ativou notificações neste dispositivo (salvo em localStorage),
 * a inscrição Web Push seja revalidada/renovada automaticamente junto ao Supabase.
 */
export async function ensureOwnerPushSubscription(api: {
  ownerPushIsSubscribed: (endpoint: string) => Promise<boolean>;
  ownerPushSubscribe: (endpoint: string, p256dh: string, auth: string) => Promise<void>;
}): Promise<boolean> {
  if (!isPushSupported()) return false;
  const locallyEnabled = localStorage.getItem(OWNER_PUSH_STORAGE_KEY) === "true";
  if (!locallyEnabled) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  try {
    let sub = await getExistingPushSubscription();
    if (!sub) {
      sub = await subscribeToPush();
    }
    const keys = sub ? pushSubscriptionToKeys(sub) : null;
    if (!keys) return false;

    const isSubscribed = await api.ownerPushIsSubscribed(keys.endpoint).catch(() => false);
    if (!isSubscribed) {
      await api.ownerPushSubscribe(keys.endpoint, keys.p256dh, keys.auth);
    }
    return true;
  } catch {
    return false;
  }
}

