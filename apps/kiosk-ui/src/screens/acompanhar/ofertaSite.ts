/**
 * Card de oferta da tela pública de acompanhamento. Decide qual produto
 * apresentar e monta o link do WhatsApp do CRM com o texto pré-preenchido.
 *
 * Quem toca no botão escreve para o CRM, o que abre a janela de 24h: a
 * resposta com preços e detalhes sai como texto livre (fa_crm_offer_info),
 * sem template da Meta. O texto abaixo é reconhecido por siteOfferKeyword em
 * supabase/functions/crm-whatsapp-webhook/offer.ts — mantenha os dois em sincronia.
 *
 * Preços ficam fora da página de propósito: moram em fa_crm_offer_info e o
 * Owner os edita sem deploy.
 */

export type OfertaSiteKind = "DEGRAU_2H" | "DEGRAU_PORTO" | "DEGRAU_DAYUSE";

export interface Oferta {
  kind: OfertaSiteKind;
  title: string;
  body: string;
  buttonLabel: string;
  /** Texto que o cliente envia ao tocar no botão. */
  whatsappText: string;
}

/** Número do canal do CRM (fa_crm_channels), sem "+". Pode ser trocado por VITE_CRM_WHATSAPP_E164. */
export const CRM_WHATSAPP_E164 = ((import.meta.env.VITE_CRM_WHATSAPP_E164 as string | undefined) ?? "559193368623").replace(/\D/g, "");

/** A oferta só aparece quando falta isto (ou menos) para o plano acabar, ou já no excedente: é a hora da decisão. */
export const OFERTA_REMAINING_MS = 15 * 60_000;

export interface OfertaInput {
  activity: "PLAYGROUND" | "CARRINHO";
  isPausada: boolean;
  childFirstName: string;
  childVisitCount: number;
  planDurationMinutes: number;
  /** Tempo restante do plano em ms; negativo no excedente. */
  remainingMs: number;
  nowMs: number;
}

/** Quinta-feira em Belém (UTC-3), sem depender do fuso do aparelho. */
export function isQuintaEmBelem(nowMs: number): boolean {
  return new Date(nowMs - 3 * 3_600_000).getUTCDay() === 4;
}

/**
 * Mesma ordem da régua do CRM: 2 horas, depois Porto Seguro, depois Day Use.
 * Só Playground (os produtos não valem para o Circuito) e nunca em pausa.
 */
export function ofertaParaSessao(i: OfertaInput): Oferta | null {
  if (i.activity !== "PLAYGROUND" || i.isPausada || i.remainingMs > OFERTA_REMAINING_MS) return null;
  const nome = i.childFirstName;

  if (i.planDurationMinutes <= 60) {
    return {
      kind: "DEGRAU_2H",
      title: "Quer mais tempo, sem ficar de olho no relógio?",
      body: `Com o plano de 2 horas, vocês almoçam ou fazem as compras no shopping com calma enquanto ${nome} brinca.`,
      buttonLabel: "Saber do plano de 2 horas",
      whatsappText: "Quero saber do plano de 2 horas",
    };
  }
  if (i.childVisitCount >= 3) {
    return {
      kind: "DEGRAU_PORTO",
      title: `${nome} já é de casa 💛`,
      body: "O Porto Seguro são 10 horas para usar em 30 dias, no dia e no horário que vocês quiserem. Os irmãos usam o mesmo saldo.",
      buttonLabel: "Saber do Porto Seguro",
      whatsappText: "Quero saber do Porto Seguro",
    };
  }
  if (i.childVisitCount >= 2 && isQuintaEmBelem(i.nowMs)) {
    return {
      kind: "DEGRAU_DAYUSE",
      title: "Fim de semana chegando?",
      body: `No Day Use, ${nome} brinca o dia inteiro: vocês saem para almoçar ou passear e voltam quando quiserem, sem contar minuto.`,
      buttonLabel: "Saber do Day Use",
      whatsappText: "Quero saber do Day Use",
    };
  }
  return null;
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/${CRM_WHATSAPP_E164}?text=${encodeURIComponent(text)}`;
}
