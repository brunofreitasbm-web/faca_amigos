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
