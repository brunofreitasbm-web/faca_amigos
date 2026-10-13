// Lógica pura do chat interno (sem React nem rede) para poder testar em vitest.
// O banco é a fonte da verdade (RLS + RPCs fa_chat_*); aqui só ficam regras de
// exibição e validação de entrada.

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_employee_id: string;
  from_owner: boolean;
  body: string;
  attachment_path: string | null;
  context: Record<string, string>;
  telegram_sent_at_ms: number | null;
  created_at_ms: number;
  /** Só no cliente: enviada otimisticamente e ainda sem confirmação do servidor. */
  pending?: boolean;
  /** Só no cliente: falhou o envio, o colaborador pode tentar de novo. */
  failed?: boolean;
}

export const CHAT_BODY_MAX = 4000;
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Telegram não exibe HEIC; JPEG/PNG/WebP cobrem câmera e print do tablet.
export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Junta mensagens por id (a nova vence, p.ex. ao chegar o UPDATE do telegram_sent_at_ms) e ordena. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m, pending: false, failed: false });
  return [...byId.values()].sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
}

/** Respostas do dono ainda não lidas pelo colaborador. */
export function countUnreadFromOwner(messages: ChatMessage[], employeeLastReadMs: number): number {
  return messages.filter((m) => m.from_owner && m.created_at_ms > employeeLastReadMs).length;
}

/**
 * Estado de uma mensagem do colaborador, como ele vê. "Lido" pelo dono não é
 * conhecido (o Telegram não avisa), então o último estado honesto é "entregue":
 * a mensagem chegou ao Telegram do dono.
 */
export function ownMessageStatus(m: ChatMessage): "FAILED" | "SENDING" | "SENT" | "DELIVERED" {
  if (m.failed) return "FAILED";
  if (m.pending) return "SENDING";
  return m.telegram_sent_at_ms ? "DELIVERED" : "SENT";
}

export const STATUS_LABEL = {
  FAILED: "Não enviada. Toque para tentar de novo",
  SENDING: "Enviando…",
  SENT: "Enviada",
  DELIVERED: "Entregue aos donos",
} as const;

export type ChatContextInput = { screen: string; unitId?: string | null; appVersion?: string; userAgent?: string };

/** Contexto automático anexado às mensagens (o servidor ainda filtra as chaves). */
export function buildChatContext(input: ChatContextInput): Record<string, string> {
  const ctx: Record<string, string> = { screen: input.screen };
  if (input.unitId) ctx.unit_id = input.unitId;
  if (input.appVersion) ctx.app_version = input.appVersion;
  if (input.userAgent) ctx.ua = input.userAgent.slice(0, 100);
  return ctx;
}

/** Texto digitado válido para envio (sem espaços sobrando, dentro do limite). */
export function normalizeChatBody(raw: string): string {
  return raw.trim().slice(0, CHAT_BODY_MAX);
}

export function canSendChat(body: string, hasImage: boolean): boolean {
  return normalizeChatBody(body).length > 0 || hasImage;
}

/** Valida a imagem JÁ comprimida: tipo aceito e até 5 MB. Lança com mensagem pronta para o usuário. */
export function assertChatImage(blob: { type: string; size: number }): void {
  if (!CHAT_IMAGE_TYPES.includes(blob.type)) {
    throw new Error("Use uma foto ou print em JPG, PNG ou WEBP.");
  }
  if (blob.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }
}

export function chatAttachmentPath(threadId: string, messageId: string, ext: string): string {
  return `${threadId}/${messageId}.${ext}`;
}
