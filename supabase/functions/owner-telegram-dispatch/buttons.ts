// Botões inline das divergências e registro do webhook que recebe os cliques
// (owner-telegram-webhook). Módulo puro: roda em teste com Node
//   node --experimental-strip-types --test buttons.test.ts

/** Tipos cuja mensagem leva os botões (o webhook só aceita estes). */
export const BUTTON_TYPES = new Set(["DIVERGENCIA_FECHAMENTO", "DIVERGENCIA_ABERTURA"]);

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/**
 * Teclado inicial de uma divergência. O callback_data casa com o regex do
 * webhook (`dv:(ok|just|pend|reopen):<uuid>`) e cabe nos 64 bytes do Telegram.
 */
export function divergenceKeyboard(notificationId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Conferido", callback_data: `dv:ok:${notificationId}` },
        { text: "💬 Pedir justificativa", callback_data: `dv:just:${notificationId}` },
      ],
      [{ text: "📌 Pendência", callback_data: `dv:pend:${notificationId}` }],
    ],
  };
}

async function sha256Hex(s: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Segredo que o Telegram devolve no header X-Telegram-Bot-Api-Secret-Token.
 * Tem que ser idêntico ao calculado dentro do owner-telegram-webhook.
 */
export function webhookSecret(token: string): Promise<string> {
  return sha256Hex(`${token}:owner-telegram-webhook`);
}

/** Impressão digital curta do segredo, para saber se o webhook precisa ser registrado de novo. */
export async function secretFingerprint(secret: string): Promise<string> {
  return (await sha256Hex(secret)).slice(0, 16);
}
