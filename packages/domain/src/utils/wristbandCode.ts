import { formatAccessCode, looksLikeAccessCode } from "./accessCode.js";

/**
 * Formata um código de pulseira para exibição em tela.
 *
 * Códigos emitidos a partir da migration 20260807000007 são o código de
 * acesso curto (11 caracteres) e saem agrupados, prontos para serem lidos
 * em voz alta: `K7M2-P9QX-3B7`.
 *
 * O resto do corpo trata das pulseiras antigas, no payload longo
 * "FA1|W|<sessionShortId>|<hmac>" — que continuam circulando no pulso das
 * crianças que já estavam no parque na virada e precisam continuar
 * legíveis até irem embora.
 */
export function getFriendlyWristbandCode(code?: string | null): string {
  if (!code) return "—";

  const clean = code.trim().replace(/^#/, "");

  if (looksLikeAccessCode(clean)) return formatAccessCode(clean);

  // Payload antigo "FA1|W|<sessionShortId>|<hmac>" ou "FA1|T|..."
  if (clean.includes("|")) {
    const parts = clean.split("|");
    if (parts.length >= 3 && parts[2]) {
      return parts[2].slice(0, 8).toUpperCase();
    }
  }

  // Hash/uuid longo
  if (clean.length > 12 && !clean.includes(" ")) {
    return clean.slice(0, 8).toUpperCase();
  }

  return clean.toUpperCase();
}
