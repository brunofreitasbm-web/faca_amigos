/**
 * Botão "Renovar" da tela pública de acompanhamento. Mostra duas opções
 * (+30 e +60 min, as do aviso de fim de plano) e abre o WhatsApp do CRM com o
 * pedido escrito. Quem envia a mensagem abre a janela de 24h, então o
 * crm-whatsapp-webhook responde em texto livre, sem template e sem o limite de
 * mensagens de Marketing da Meta, e registra RENOVACAO_SOLICITADA para o balcão.
 *
 * O texto é lido por renewRequest em
 * supabase/functions/crm-whatsapp-webhook/offer.ts — mantenha os dois em sincronia.
 * Valores: regra do dono, os mesmos de RENEWAL_OPTIONS em copy.ts.
 */
import { RENEWAL_OPTIONS } from "./copy.js";
import { OFERTA_REMAINING_MS, whatsappUrl } from "./ofertaSite.js";

export interface RenovarInput {
  activity: "PLAYGROUND" | "CARRINHO";
  isPausada: boolean;
  childFirstName: string;
  /** Tempo restante do plano em ms; negativo no excedente. */
  remainingMs: number;
}

export interface RenovarOpcao {
  minutes: 30 | 60;
  cents: number;
  whatsappUrl: string;
}

/**
 * Só no Playground (durações e valores são os dele), nos últimos 15 minutos do
 * plano ou no excedente, e nunca em pausa.
 */
export function opcoesDeRenovacao(i: RenovarInput): RenovarOpcao[] | null {
  if (i.activity !== "PLAYGROUND" || i.isPausada || i.remainingMs > OFERTA_REMAINING_MS) return null;
  return RENEWAL_OPTIONS.filter((o): o is Extract<typeof o, { minutes: 30 | 60 }> => o.minutes === 30 || o.minutes === 60).map((o) => ({
    minutes: o.minutes,
    cents: o.cents,
    whatsappUrl: whatsappUrl(`Quero renovar +${o.minutes} min da ${i.childFirstName}`),
  }));
}
