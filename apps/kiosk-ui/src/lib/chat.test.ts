import { describe, expect, it } from "vitest";
import {
  assertChatImage,
  buildChatContext,
  canSendChat,
  CHAT_BODY_MAX,
  chatAttachmentPath,
  countUnreadFromOwner,
  mergeMessages,
  normalizeChatBody,
  ownMessageStatus,
  type ChatMessage,
} from "./chat.js";

function msg(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    thread_id: "t1",
    sender_employee_id: "e1",
    from_owner: false,
    body: "oi",
    attachment_path: null,
    context: {},
    telegram_sent_at_ms: null,
    created_at_ms: 1000,
    ...over,
  };
}

describe("mergeMessages", () => {
  it("ordena por data e não duplica", () => {
    const out = mergeMessages([msg({ id: "b", created_at_ms: 2000 })], [msg({ id: "a", created_at_ms: 1000 }), msg({ id: "b", created_at_ms: 2000 })]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("a confirmação do servidor limpa pending/failed e traz o telegram_sent_at_ms", () => {
    const optimistic = msg({ id: "a", pending: true, failed: true });
    const out = mergeMessages([optimistic], [msg({ id: "a", telegram_sent_at_ms: 5 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.pending).toBe(false);
    expect(out[0]!.failed).toBe(false);
    expect(out[0]!.telegram_sent_at_ms).toBe(5);
  });
});

describe("countUnreadFromOwner", () => {
  it("conta só respostas do dono depois da última leitura", () => {
    const list = [
      msg({ id: "1", from_owner: true, created_at_ms: 100 }),
      msg({ id: "2", from_owner: true, created_at_ms: 300 }),
      msg({ id: "3", from_owner: false, created_at_ms: 400 }),
    ];
    expect(countUnreadFromOwner(list, 200)).toBe(1);
    expect(countUnreadFromOwner(list, 0)).toBe(2);
    expect(countUnreadFromOwner(list, 999)).toBe(0);
  });
});

describe("ownMessageStatus", () => {
  it("segue o ciclo falha > enviando > enviada > entregue", () => {
    expect(ownMessageStatus(msg({ id: "a", failed: true, pending: true }))).toBe("FAILED");
    expect(ownMessageStatus(msg({ id: "a", pending: true }))).toBe("SENDING");
    expect(ownMessageStatus(msg({ id: "a" }))).toBe("SENT");
    expect(ownMessageStatus(msg({ id: "a", telegram_sent_at_ms: 1 }))).toBe("DELIVERED");
  });
});

describe("buildChatContext", () => {
  it("só inclui o que existe e corta o user agent", () => {
    expect(buildChatContext({ screen: "CAIXA" })).toEqual({ screen: "CAIXA" });
    const ctx = buildChatContext({ screen: "PDV", unitId: "u1", appVersion: "1.2", userAgent: "x".repeat(300) });
    expect(ctx.unit_id).toBe("u1");
    expect(ctx.app_version).toBe("1.2");
    expect(ctx.ua).toHaveLength(100);
  });
});

describe("texto", () => {
  it("normaliza e limita", () => {
    expect(normalizeChatBody("  oi  ")).toBe("oi");
    expect(normalizeChatBody("a".repeat(CHAT_BODY_MAX + 10))).toHaveLength(CHAT_BODY_MAX);
  });
  it("não envia vazio, a não ser que haja imagem", () => {
    expect(canSendChat("   ", false)).toBe(false);
    expect(canSendChat("   ", true)).toBe(true);
    expect(canSendChat("oi", false)).toBe(true);
  });
});

describe("assertChatImage", () => {
  it("aceita JPG/PNG/WEBP até 5 MB", () => {
    expect(() => assertChatImage({ type: "image/webp", size: 1024 })).not.toThrow();
  });
  it("recusa HEIC, PDF e arquivos grandes", () => {
    expect(() => assertChatImage({ type: "image/heic", size: 1024 })).toThrow(/JPG, PNG ou WEBP/);
    expect(() => assertChatImage({ type: "application/pdf", size: 1024 })).toThrow();
    expect(() => assertChatImage({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toThrow(/5 MB/);
  });
});

describe("chatAttachmentPath", () => {
  it("prefixa com a conversa, como a policy do bucket exige", () => {
    expect(chatAttachmentPath("t1", "m1", "webp")).toBe("t1/m1.webp");
  });
});
