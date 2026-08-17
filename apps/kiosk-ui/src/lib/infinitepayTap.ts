/**
 * Integração InfiniteTap (InfinitePay): cobrança por aproximação usando o
 * próprio celular/tablet como maquininha. Documentação oficial:
 * https://www.infinitepay.io/checkout-tap
 *
 * Só funciona no MESMO aparelho onde o app InfinitePay está instalado (NFC
 * do tablet) — ou seja, no canal PWA/tablet, não no Electron desktop (sem
 * NFC). O fluxo é 100% local via deeplink, sem chave de API: o app kiosk
 * chama `infinitepaydash://infinitetap-app` com os dados da cobrança, o
 * app InfinitePay processa o pagamento e devolve o resultado chamando de
 * volta a URL passada em `result_url`.
 */

const TAP_DEEPLINK_BASE = "infinitepaydash://infinitetap-app";
const APP_CLIENT_REFERRER = "FacaAmigosKiosk";
const STORAGE_PREFIX = "fa_tap_pending:";
export const TAP_RETURN_PARAM = "tap_retorno";

export type TapPaymentMethod = "CREDITO" | "DEBITO";

export interface TapChargeParams {
  amountCents: number;
  method: TapPaymentMethod;
  installments?: number;
  orderId: string;
  handle?: string;
  docNumber?: string;
}

function tapResultUrl(): string {
  // Usa sempre o domínio público (o mesmo do QR de pareamento), nunca
  // window.location.origin: no Electron desktop isso seria um servidor
  // local (sem sentido pro app InfinitePay reabrir), e no tablet o app
  // precisa reabrir exatamente a URL pública que o operador já tem em uso.
  const base = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || window.location.origin;
  return `${base}/?${TAP_RETURN_PARAM}=1`;
}

export function buildTapDeeplink(params: TapChargeParams): string {
  const query = new URLSearchParams({
    amount: String(params.amountCents),
    payment_method: params.method === "CREDITO" ? "credit" : "debit",
    installments: String(params.installments ?? 1),
    order_id: params.orderId,
    result_url: tapResultUrl(),
    app_client_referrer: APP_CLIENT_REFERRER,
    // Documentado como necessário só no iOS, mas incluir sempre não tem custo.
    af_force_deeplink: "true",
  });
  // A InfinitePay documenta o handle sem o "$" inicial — aceita vir com ou
  // sem para não depender de quem preencher a env var lembrar disso.
  if (params.handle) query.set("handle", params.handle.replace(/^\$/, ""));
  if (params.docNumber) query.set("doc_number", params.docNumber.replace(/\D/g, ""));
  return `${TAP_DEEPLINK_BASE}?${query.toString()}`;
}

/** Dispara a cobrança: sai da página atual para o app InfinitePay via deeplink. */
export function openTapCharge(params: TapChargeParams): void {
  window.location.href = buildTapDeeplink(params);
}

export interface PendingTapCheckout {
  kind: "checkout";
  sessionIds: string[];
  employeeId: string;
  method: TapPaymentMethod;
  amountCents: number;
  closedAtMs: number;
  /** Recibos já montados com tudo, exceto o `code` (só sai depois do fa_checkout confirmar). */
  receiptsBase: Array<Record<string, unknown>>;
}

export interface PendingTapPdv {
  kind: "pdv";
  unitId: string;
  employeeId: string;
  method: TapPaymentMethod;
  amountCents: number;
  items: { productId: string; quantity: number }[];
}

export type PendingTapPayload = PendingTapCheckout | PendingTapPdv;

/**
 * O retorno do InfiniteTap pode reabrir a página como uma navegação nova
 * (aba/instância recarregada) — por isso o essencial da cobrança pendente
 * vai pro localStorage (sobrevive a isso), em vez de depender de estado em
 * memória do React que se perde ao sair para o app InfinitePay.
 */
export function savePendingTap(orderId: string, payload: PendingTapPayload): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + orderId, JSON.stringify(payload));
  } catch {
    // localStorage indisponível (ex.: modo privado) — o retorno não vai achar
    // o pendente e cai no fallback de erro; nada melhor a fazer aqui.
  }
}

export function readPendingTap(orderId: string): PendingTapPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + orderId);
    return raw ? (JSON.parse(raw) as PendingTapPayload) : null;
  } catch {
    return null;
  }
}

export function clearPendingTap(orderId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + orderId);
  } catch {
    // ignora
  }
}

export interface TapReturnResult {
  orderId: string;
  nsu: string;
  authorization: string;
  cardBrand: string;
  warning: string | null;
  success: boolean;
}

/** Lê os parâmetros que o app InfinitePay anexa na volta (result_url). */
export function parseTapReturn(search: string): TapReturnResult | null {
  const params = new URLSearchParams(search);
  if (params.get(TAP_RETURN_PARAM) !== "1") return null;
  const orderId = params.get("order_id");
  if (!orderId) return null;
  const warning = params.get("warning");
  return {
    orderId,
    nsu: params.get("nsu") ?? "",
    authorization: params.get("aut") ?? "",
    cardBrand: params.get("card_brand") ?? "",
    warning,
    success: !warning,
  };
}
