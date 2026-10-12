import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  answeredKeyboard,
  belemStamp,
  chatWebhookSecret,
  HELP_TEXT,
  parseQuickReply,
  QUICK_REPLIES,
  REACTION_DELIVERED,
} from "../_shared/chatTelegram.ts";

// Webhook do bot de chat interno. verify_jwt=false porque o Telegram não envia JWT; a
// autenticação é (1) o header X-Telegram-Bot-Api-Secret-Token derivado do token do bot
// e (2) o remetente ser exatamente o dono (CHAT_TELEGRAM_OWNER_ID). Qualquer outra pessoa
// que achar o bot é ignorada em silêncio.

const OK = () => new Response("ok");

Deno.serve(async (req) => {
  if (req.method !== "POST") return OK();
  const token = Deno.env.get("CHAT_TELEGRAM_BOT_TOKEN");
  const ownerTgId = Deno.env.get("CHAT_TELEGRAM_OWNER_ID");
  if (!token || !ownerTgId) return new Response("not configured", { status: 500 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await chatWebhookSecret(token)) {
    return new Response("forbidden", { status: 403 });
  }

  // deno-lint-ignore no-explicit-any
  const update = await req.json().catch(() => null) as any;
  if (!update) return OK();

  const api = async (method: string, payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) console.error(`Telegram ${method} respondeu ${res.status}:`, await res.text().catch(() => ""));
    } catch (e) {
      console.error(`Telegram ${method} falhou:`, String(e));
    }
  };
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---------- botões de resposta rápida ----------
  const cq = update.callback_query;
  if (cq) {
    const answer = (text?: string, alert = false) =>
      api("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) });
    if (String(cq.from?.id) !== ownerTgId) {
      await answer();
      return OK();
    }
    if (cq.data === "noop") {
      await answer();
      return OK();
    }
    const parsed = parseQuickReply(String(cq.data ?? ""));
    if (!parsed || !cq.message) {
      await answer("Ação inválida", true);
      return OK();
    }
    const { data: orig } = await admin.from("fa_kiosk_chat_messages").select("thread_id").eq("id", parsed.messageId).maybeSingle();
    if (!orig) {
      await answer("Mensagem não encontrada", true);
      return OK();
    }
    const { error } = await admin.rpc("fa_chat_owner_reply", {
      p_thread_id: orig.thread_id,
      p_body: QUICK_REPLIES[parsed.action],
      p_telegram_message_id: null,
    });
    if (error) {
      console.error("fa_chat_owner_reply (botão):", error.message);
      await answer("Não consegui gravar. Tente de novo.", true);
      return OK();
    }
    await api("editMessageReplyMarkup", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: answeredKeyboard(parsed.action, belemStamp(new Date())),
    });
    await answer("Enviado");
    return OK();
  }

  // ---------- resposta digitada (reply a uma mensagem do bot) ----------
  const msg = update.message;
  if (!msg) return OK();
  if (String(msg.from?.id) !== ownerTgId) return OK();

  const say = (text: string) =>
    api("sendMessage", { chat_id: msg.chat.id, text, parse_mode: "HTML", reply_to_message_id: msg.message_id });

  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo || typeof msg.text !== "string" || msg.text.startsWith("/")) {
    await say(HELP_TEXT);
    return OK();
  }

  const { data: orig } = await admin
    .from("fa_kiosk_chat_messages")
    .select("thread_id")
    .eq("telegram_message_id", replyTo)
    .maybeSingle();
  if (!orig) {
    await say(HELP_TEXT);
    return OK();
  }

  const { error } = await admin.rpc("fa_chat_owner_reply", {
    p_thread_id: orig.thread_id,
    p_body: msg.text,
    p_telegram_message_id: msg.message_id,
  });
  if (error) {
    console.error("fa_chat_owner_reply:", error.message);
    await say(error.message.includes("longa") ? "Mensagem longa demais (máx. 4000 caracteres)." : "Não consegui gravar. Tente de novo.");
    return OK();
  }
  await api("setMessageReaction", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reaction: [{ type: "emoji", emoji: REACTION_DELIVERED }],
  });
  return OK();
});
