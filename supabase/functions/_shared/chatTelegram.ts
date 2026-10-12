// Lógica pura do bot de chat interno (chat-telegram-notify / chat-telegram-webhook).
// Sem Deno nem rede aqui, para rodar em teste com Node:
//   node --experimental-strip-types --test supabase/functions/_shared/chatTelegram.test.ts

export const TELEGRAM_MAX_TEXT = 4096;

export const QUICK_REPLIES = {
  rec: "Recebi 👍",
  res: "Resolvido ✅",
  lig: "Ligue para mim 📞",
} as const;
export type QuickReplyAction = keyof typeof QUICK_REPLIES;

// Telegram só aceita um conjunto fixo de emojis como reação (✅ não está nele).
export const REACTION_DELIVERED = "👍";
export const REACTION_READ = "👀";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ChatContext = { unit_id?: string; screen?: string; app_version?: string; ua?: string };

/** Mensagem do colaborador como o dono a vê no Telegram (HTML). */
export function formatEmployeeMessage(input: {
  employeeName: string;
  unitName?: string | null;
  context?: ChatContext | null;
  body: string;
  hasAttachment?: boolean;
}): string {
  const who = escapeHtml(input.employeeName || "Colaborador");
  const unit = input.unitName ? ` (${escapeHtml(input.unitName)})` : "";
  const bits: string[] = [];
  if (input.context?.screen) bits.push(`tela ${escapeHtml(input.context.screen)}`);
  if (input.context?.app_version) bits.push(`v${escapeHtml(input.context.app_version)}`);
  const meta = bits.length ? `\n<i>${bits.join(" · ")}</i>` : "";
  const text = input.body.trim();
  const attach = input.hasAttachment ? (text ? "\n📎 com imagem (mensagem acima)" : "📎 enviou uma imagem") : "";
  const out = `💬 <b>${who}</b>${unit}${meta}\n\n${escapeHtml(text)}${attach}`;
  return out.length > TELEGRAM_MAX_TEXT ? `${out.slice(0, TELEGRAM_MAX_TEXT - 1)}…` : out;
}

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/** callback_data = `cr:<ação>:<uuid>` (43 bytes, cabe nos 64 do Telegram). */
export function quickReplyKeyboard(messageId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: QUICK_REPLIES.rec, callback_data: `cr:rec:${messageId}` },
        { text: QUICK_REPLIES.res, callback_data: `cr:res:${messageId}` },
      ],
      [{ text: QUICK_REPLIES.lig, callback_data: `cr:lig:${messageId}` }],
    ],
  };
}

export function parseQuickReply(data: string): { action: QuickReplyAction; messageId: string } | null {
  const m = /^cr:(rec|res|lig):([0-9a-f-]{36})$/.exec(data);
  return m ? { action: m[1] as QuickReplyAction, messageId: m[2]! } : null;
}

/** Teclado depois do clique: mostra o que foi respondido e some com os botões. */
export function answeredKeyboard(action: QuickReplyAction, when: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: `Respondido: ${QUICK_REPLIES[action]} · ${when}`, callback_data: "noop" }]] };
}

/** Segredo do webhook derivado do token do bot (mesma ideia do owner-telegram-webhook). */
export async function chatWebhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`${token}:chat-telegram-webhook`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const HELP_TEXT =
  "Para responder, use <b>Responder</b> (deslize) na mensagem do colaborador, ou toque num dos botões abaixo dela.";

export function belemStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Belem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}
