import { createHmac } from "node:crypto";

/**
 * Payload de QR sem dado pessoal (seção 9.3 do plano): versão, tipo,
 * ID curto da sessão e HMAC truncado. A leitura/pareamento por câmera
 * ou leitor USB HID ainda não está implementada (é tarefa de hardware
 * da Fase 0) — o checkout desta fase fecha por seleção na tela, não
 * por bipagem. Os códigos já saem no formato certo para quando o
 * hardware for ligado, sem precisar tocar no formato depois.
 */
export function wristbandPayload(sessionShortId: string, hmacKey: string): string {
  return `FA1|W|${sessionShortId}|${hmac8(sessionShortId, hmacKey)}`;
}

export function ticketPayload(sessionShortId: string, hmacKey: string): string {
  return `FA1|T|${sessionShortId}|${hmac8(sessionShortId, hmacKey)}`;
}

function hmac8(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 8);
}
