// Resposta às ofertas da régua do CRM (migration 20261001130000): botões
// "Quero saber mais" (OFERTA_INFO) e "Agora não" (OFERTA_NAO) dos templates
// de crm-templates-bootstrap. Separado do index.ts para ser testável.

export type OfferButton = "OFERTA_INFO" | "OFERTA_NAO";

/** Kinds de fa_crm_automation_sends cujos templates trazem os botões de oferta. */
export const OFFER_KINDS = [
  "DEGRAU_2H", "DEGRAU_PORTO", "DEGRAU_DAYUSE", "VIP", "CROSS_ATIVIDADE", "WINBACK_1", "WINBACK_2",
] as const;

/**
 * Toque num botão de oferta (ButtonPayload) ou o cliente digitando o próprio
 * título do botão. "quero" sozinho NÃO conta: continua sendo o aceite do
 * opt-in (QR code do balcão).
 */
export function offerButton(buttonPayload: string | undefined, body: string): OfferButton | null {
  if (buttonPayload === "OFERTA_INFO" || buttonPayload === "OFERTA_NAO") return buttonPayload;
  const typed = body.toLowerCase().replace(/[^a-zà-ú]/g, "");
  if (typed === "querosabermais") return "OFERTA_INFO";
  if (typed === "agoranão" || typed === "agoranao") return "OFERTA_NAO";
  return null;
}

/** Chave em fa_crm_offer_info: os dois toques do winback dividem o mesmo texto. */
export const offerInfoKey = (kind: string) => (kind.startsWith("WINBACK_") ? "WINBACK" : kind);

export const OFFER_INFO_FALLBACK =
  "Obrigado pelo interesse! 💛 Um atendente vai te responder por aqui com os detalhes em instantes.";

export const OFFER_DECLINE_REPLY =
  "Tudo bem! 💛 Não vamos mais te mandar esse tipo de sugestão por um tempo. Seguimos à disposição por aqui.";

/** Produtos que a resposta ao aceite de marketing e o card do site podem apresentar (sem winback, que é sobre o Olhar). */
export const PRODUCT_OFFER_KINDS = ["DEGRAU_2H", "DEGRAU_PORTO", "DEGRAU_DAYUSE", "VIP", "CROSS_ATIVIDADE"] as const;

export interface LifecycleCandidate {
  kind: string;
  guardian_id: string | null;
  unit_id: string | null;
}

/**
 * Primeira oferta de produto do responsável em fa_crm_lc_candidates. A RPC já
 * devolve ordenado por prioridade (2H > Porto > VIP > Day Use > Cross), então
 * basta o primeiro que casa.
 */
export function pickProductOffer(candidates: LifecycleCandidate[] | null | undefined, guardianId: string): LifecycleCandidate | null {
  return (
    (candidates ?? []).find(
      (c) => c.guardian_id === guardianId && (PRODUCT_OFFER_KINDS as readonly string[]).includes(c.kind),
    ) ?? null
  );
}

/** Texto da resposta ao aceite de marketing quando há uma oferta de produto para o responsável. */
export function welcomeWithOffer(welcome: string, offerText: string): string {
  return `${welcome}\n\nUma sugestão para a próxima visita: ${offerText}`;
}

export type SiteOfferKind = "DEGRAU_2H" | "DEGRAU_PORTO" | "DEGRAU_DAYUSE";

/** Mensagens com mais que isso não são o texto pré-preenchido do card do site. */
const SITE_KEYWORD_MAX_LENGTH = 60;

/**
 * Pedido vindo do card de oferta da tela de acompanhamento: o link wa.me já
 * abre a conversa com "Quero saber do plano de 2 horas" / "…do Porto Seguro" /
 * "…do Day Use". O cliente que escreve abre a janela de 24h, então a resposta
 * é texto livre, sem template. Mantenha em sincronia com
 * apps/kiosk-ui/src/screens/acompanhar/ofertaSite.ts.
 */
export function siteOfferKeyword(body: string): SiteOfferKind | null {
  if (body.length > SITE_KEYWORD_MAX_LENGTH) return null;
  const t = body.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t.includes("quero")) return null;
  if (/\bporto seguro\b/.test(t)) return "DEGRAU_PORTO";
  if (/\bday ?use\b/.test(t)) return "DEGRAU_DAYUSE";
  if (/\b(2 horas|2 ?h|duas horas)\b/.test(t)) return "DEGRAU_2H";
  return null;
}
