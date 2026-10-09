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
  closingHourMonSat: string | null;
  closingHourSun: string | null;
}

export interface RenovarOpcao {
  minutes: number;
  cents: number;
  whatsappUrl: string;
}

/**
 * Só no Playground (durações e valores são os dele), nos últimos 15 minutos do
 * plano ou no excedente, e nunca em pausa.
 */
export function opcoesDeRenovacao(i: RenovarInput): RenovarOpcao[] | null {
  if (i.activity !== "PLAYGROUND" || i.isPausada || i.remainingMs > OFERTA_REMAINING_MS) return null;

  // Calculando tempo até fechamento
  const nowMs = Date.now();
  const expectedEndMs = nowMs + Math.max(0, i.remainingMs);
  
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Belem",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(expectedEndMs);
  let isSunday = false, h = 0, m = 0;
  for (const p of parts) {
    if (p.type === "weekday" && p.value.toLowerCase().startsWith("sun")) isSunday = true;
    if (p.type === "hour") h = parseInt(p.value, 10);
    if (p.type === "minute") m = parseInt(p.value, 10);
  }
  
  const configuredTime = isSunday ? i.closingHourSun : i.closingHourMonSat;
  const fallbackHour = isSunday ? 21 : 22;
  let closingHour = fallbackHour;
  let closingMinute = 0;
  
  if (configuredTime) {
    const parts = configuredTime.split(":");
    const ch = parts.length > 0 ? Number(parts[0]) : NaN;
    const cm = parts.length > 1 ? Number(parts[1]) : NaN;
    if (!isNaN(ch) && !isNaN(cm)) {
      closingHour = ch;
      closingMinute = cm;
    }
  }

  const minutesToClosing = (closingHour * 60 + closingMinute) - (h * 60 + m);

  const maxMins = minutesToClosing > 0 ? minutesToClosing : 0;
  if (maxMins <= 0) return null;

  const validOptions = RENEWAL_OPTIONS.filter(
    (o): o is Extract<typeof o, { minutes: Extract<typeof o.minutes, number> }> => 
      (o.minutes === 30 || o.minutes === 60) && o.minutes <= maxMins
  ).map((o) => ({
    minutes: o.minutes,
    cents: o.cents,
    whatsappUrl: whatsappUrl(`Quero renovar +${o.minutes} min da ${i.childFirstName}`),
  })) as RenovarOpcao[];

  if (maxMins < 60) {
    const hasExactly = validOptions.some(o => o.minutes === maxMins);
    if (!hasExactly) {
       const exactCents = maxMins * 160;
       const proportionalCents = Math.floor(exactCents / 100) * 100; // Arredonda para baixo (sem centavos)
       validOptions.push({
         minutes: maxMins,
         cents: proportionalCents,
         whatsappUrl: whatsappUrl(`Quero renovar +${maxMins} min da ${i.childFirstName}`),
       });
    }
  }

  return validOptions.sort((a, b) => a.minutes - b.minutes);
}
