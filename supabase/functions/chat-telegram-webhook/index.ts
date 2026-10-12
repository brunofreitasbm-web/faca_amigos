import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  answeredKeyboard,
  belemStamp,
  chatWebhookSecret,
  firstName,
  HELP_TEXT,
  idReply,
  parseQuickReply,
  QUICK_REPLIES,
  REACTION_DELIVERED,
} from "../_shared/chatTelegram.ts";

// Webhook do bot de chat interno. verify_jwt=false porque o Telegram não envia JWT. Autenticação:
//  1) header X-Telegram-Bot-Api-Secret-Token derivado do token do bot;
//  2) a mensagem vem do chat configurado (CHAT_TELEGRAM_CHAT_ID: o grupo dos admins ou o chat direto);
//  3) o remetente (from.id) está em fa_chat_admins.tg_user_id. Estar no grupo NÃO basta.
// Exceção: /id em qualquer chat responde o id de quem perguntou (serve para cadastrar um admin novo).

const OK = () => new Response("ok");

Deno.serve(async (req) => {
  if (req.method !== "POST") return OK();
  const token = Deno.env.get("CHAT_TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("CHAT_TELEGRAM_CHAT_ID") ?? Deno.env.get("CHAT_TELEGRAM_OWNER_ID");
  if (!token || !chatId) return new Response("not configured", { status: 500 });
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

  // Admin do chat pelo id do Telegram (nome para assinar o botão).
  async function adminName(tgUserId: unknown): Promise<string | null> {
    if (typeof tgUserId !== "number") return null;
    const { data: a } = await admin.from("fa_chat_admins").select("employee_id").eq("tg_user_id", tgUserId).maybeSingle();
    if (!a) return null;
    const { data: e } = await admin.from("fa_kiosk_employees").select("full_name").eq("id", a.employee_id).maybeSingle();
    return firstName(e?.full_name);
  }

  // ---------- botões de resposta rápida ----------
  const cq = update.callback_query;
  if (cq) {
    const answer = (text?: string, alert = false) =>
      api("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) });
    const who = String(cq.message?.chat?.id) === chatId ? await adminName(cq.from?.id) : null;
    if (!who) {
      await answer("Você não é admin deste chat", true);
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
      p_tg_user_id: cq.from.id,
    });
    if (error) {
      console.error("fa_chat_owner_reply (botão):", error.message);
      await answer("Não consegui gravar. Tente de novo.", true);
      return OK();
    }
    await api("editMessageReplyMarkup", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: answeredKeyboard(parsed.action, who, belemStamp(new Date())),
    });
    await answer("Enviado");
    return OK();
  }

  // ---------- mensagens ----------
  const msg = update.message;
  if (!msg || typeof msg.text !== "string") return OK();

  const say = (text: string) =>
    api("sendMessage", { chat_id: msg.chat.id, text, parse_mode: "HTML", reply_to_message_id: msg.message_id });

  // /id (ou /id@bot): qualquer pessoa descobre o PRÓPRIO id. Não concede nenhum acesso.
  if (/^\/id(@\w+)?(\s|$)/.test(msg.text)) {
    await say(idReply(msg.from?.id ?? ""));
    return OK();
  }

  // Daqui para baixo só vale no chat configurado e para admins cadastrados.
  if (String(msg.chat?.id) !== chatId) return OK();
  if (!(await adminName(msg.from?.id))) return OK();

  const isPrivate = msg.chat.type === "private";
  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo || msg.text.startsWith("/")) {
    // No grupo, conversa solta entre os admins é normal: não responder.
    if (isPrivate) await say(HELP_TEXT);
    return OK();
  }

  const { data: orig } = await admin
    .from("fa_kiosk_chat_messages")
    .select("thread_id")
    .eq("telegram_message_id", replyTo)
    .maybeSingle();
  if (!orig) {
    if (isPrivate) await say(HELP_TEXT);
    return OK();
  }

  const { error } = await admin.rpc("fa_chat_owner_reply", {
    p_thread_id: orig.thread_id,
    p_body: msg.text,
    p_telegram_message_id: msg.message_id,
    p_tg_user_id: msg.from.id,
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
