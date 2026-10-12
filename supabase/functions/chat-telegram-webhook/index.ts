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
  replyPromptHtml,
} from "../_shared/chatTelegram.ts";

// Webhook do bot de chat interno. verify_jwt=false porque o Telegram não envia JWT. Autenticação:
//  1) header X-Telegram-Bot-Api-Secret-Token derivado do token do bot;
//  2) a mensagem vem de um chat autorizado: o grupo padrão (CHAT_TELEGRAM_CHAT_ID) ou o grupo de alguma unidade (fa_chat_unit_groups);
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

  // Chats autorizados: o grupo padrão e o grupo de cada unidade.
  async function isAllowedChat(id: unknown): Promise<boolean> {
    const s = String(id);
    if (s === chatId) return true;
    const { data } = await admin.from("fa_chat_unit_groups").select("tg_chat_id");
    return (data ?? []).some((r: { tg_chat_id: number }) => String(r.tg_chat_id) === s);
  }

  // Como api(), mas devolve o message_id da mensagem enviada (precisamos dele para ligar a resposta à conversa).
  async function sendReturningId(payload: Record<string, unknown>): Promise<number | null> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        console.error("sendMessage falhou:", res.status, data?.description ?? "");
        return null;
      }
      return data.result?.message_id ?? null;
    } catch (e) {
      console.error("sendMessage falhou:", String(e));
      return null;
    }
  }

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
    const who = (await isAllowedChat(cq.message?.chat?.id)) ? await adminName(cq.from?.id) : null;
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
    const { data: orig } = await admin.from("fa_kiosk_chat_messages").select("thread_id, context").eq("id", parsed.messageId).maybeSingle();
    if (!orig) {
      await answer("Mensagem não encontrada", true);
      return OK();
    }

    // "Responder por texto": o bot manda uma caixa de resposta (force_reply) só para quem tocou.
    if (parsed.action === "txt") {
      const { data: th } = await admin.from("fa_kiosk_chat_threads").select("employee_id").eq("id", orig.thread_id).maybeSingle();
      const { data: emp } = th
        ? await admin.from("fa_kiosk_employees").select("full_name").eq("id", th.employee_id).maybeSingle()
        : { data: null };
      let unitName: string | null = null;
      if (orig.context?.unit_id) {
        const { data: u } = await admin.from("fa_kiosk_units").select("name").eq("id", orig.context.unit_id).maybeSingle();
        unitName = u?.name ?? null;
      }
      const promptId = await sendReturningId({
        chat_id: cq.message.chat.id,
        text: replyPromptHtml({ adminName: who, adminTgId: cq.from.id, employeeName: emp?.full_name ?? "o colaborador", unitName }),
        parse_mode: "HTML",
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Digite sua resposta…" },
      });
      if (promptId === null) {
        await answer("Não consegui abrir a caixa de resposta. Tente de novo.", true);
        return OK();
      }
      await admin.from("fa_chat_reply_prompts").upsert({
        tg_chat_id: cq.message.chat.id,
        tg_message_id: promptId,
        thread_id: orig.thread_id,
        admin_tg_user_id: cq.from.id,
      });
      await answer("Digite a resposta na caixa abaixo");
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
      reply_markup: answeredKeyboard(parsed.action, who, belemStamp(new Date()), parsed.messageId),
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
    await say(idReply(msg.from?.id ?? "", msg.chat?.id));
    return OK();
  }

  // Daqui para baixo só vale no chat configurado e para admins cadastrados.
  if (!(await isAllowedChat(msg.chat?.id))) return OK();
  if (!(await adminName(msg.from?.id))) return OK();

  const isPrivate = msg.chat.type === "private";
  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo || msg.text.startsWith("/")) {
    // No grupo, conversa solta entre os admins é normal: não responder.
    if (isPrivate) await say(HELP_TEXT);
    return OK();
  }

  // 1) resposta à caixa "Responder por texto"; 2) resposta (deslizar) direto à mensagem do colaborador.
  let threadId: string | null = null;
  const { data: prompt } = await admin
    .from("fa_chat_reply_prompts")
    .select("thread_id")
    .eq("tg_chat_id", msg.chat.id)
    .eq("tg_message_id", replyTo)
    .maybeSingle();
  if (prompt) threadId = prompt.thread_id;
  else {
    // O Telegram numera as mensagens POR grupo: o mesmo número pode existir em dois grupos. Prefere a mensagem
    // deste chat; mensagens antigas (telegram_chat_id nulo) valem para o grupo padrão.
    const { data: orig } = await admin
      .from("fa_kiosk_chat_messages")
      .select("thread_id")
      .eq("telegram_message_id", replyTo)
      .or(`telegram_chat_id.eq.${msg.chat.id},telegram_chat_id.is.null`)
      .order("telegram_chat_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    threadId = orig?.thread_id ?? null;
  }
  if (!threadId) {
    if (isPrivate) await say(HELP_TEXT);
    return OK();
  }

  const { data: saved, error } = await admin.rpc("fa_chat_owner_reply", {
    p_thread_id: threadId,
    p_body: msg.text,
    p_telegram_message_id: msg.message_id,
    p_tg_user_id: msg.from.id,
  });
  if (!error && saved?.id) {
    // guarda em qual grupo a resposta foi dada (a reação 👀 de "lido" precisa saber)
    await admin.from("fa_kiosk_chat_messages").update({ telegram_chat_id: msg.chat.id }).eq("id", saved.id);
  }
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
