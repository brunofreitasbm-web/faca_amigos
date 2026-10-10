import { createClient } from "jsr:@supabase/supabase-js@2";

// EXPORTADA da produção (Edge Function owner-telegram-webhook, v1, criada por
// brunofreitasbm@gmail.com em 2026-10-10). Texto igual ao deployado; só este
// comentário foi acrescentado. Par das migrations owner_telegram_v2_*.

// Webhook do bot do Telegram (botões inline das divergências).
// verify_jwt=false porque o Telegram não envia JWT; a autenticação é o header
// X-Telegram-Bot-Api-Secret-Token (derivado do token do bot, registrado pelo owner-telegram-dispatch)
// + checagem de que o clique veio do chat configurado.

const OK = () => new Response("ok");

async function webhookSecret(token: string): Promise<string> {
  const data = new TextEncoder().encode(`${token}:owner-telegram-webhook`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STATUS_BY_ACTION: Record<string, string> = {
  ok: "CONFERIDA",
  just: "JUSTIFICATIVA_PEDIDA",
  pend: "PENDENCIA",
  reopen: "ABERTA",
};

const TOAST: Record<string, string> = {
  CONFERIDA: "Marcado como conferido",
  JUSTIFICATIVA_PEDIDA: "Justificativa marcada como pedida",
  PENDENCIA: "Marcado como pendência",
  ABERTA: "Reaberto",
};

type Button = { text: string; callback_data: string };

function initialKeyboard(id: string): Button[][] {
  return [
    [
      { text: "✅ Conferido", callback_data: `dv:ok:${id}` },
      { text: "💬 Pedir justificativa", callback_data: `dv:just:${id}` },
    ],
    [{ text: "📌 Pendência", callback_data: `dv:pend:${id}` }],
  ];
}

function keyboardFor(id: string, status: string, who: string, when: string): Button[][] {
  const reopen = { text: "↩️ Reabrir", callback_data: `dv:reopen:${id}` };
  const conferido = { text: "✅ Conferido", callback_data: `dv:ok:${id}` };
  if (status === "CONFERIDA") {
    return [[{ text: `✅ Conferido · ${who} · ${when}`, callback_data: "noop" }], [reopen]];
  }
  if (status === "JUSTIFICATIVA_PEDIDA") {
    return [[{ text: `💬 Justificativa pedida · ${who} · ${when}`, callback_data: "noop" }], [conferido, reopen]];
  }
  if (status === "PENDENCIA") {
    return [[{ text: `📌 Pendência · ${who} · ${when}`, callback_data: "noop" }], [conferido, reopen]];
  }
  return initialKeyboard(id);
}

function belemStamp(d: Date): string {
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return OK();

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return new Response("not configured", { status: 500 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await webhookSecret(token)) {
    return new Response("forbidden", { status: 403 });
  }

  // deno-lint-ignore no-explicit-any
  const update = await req.json().catch(() => null) as any;
  const cq = update?.callback_query;
  if (!cq) return OK();

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
  const answer = (text?: string, alert = false) =>
    api("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) });

  const data = String(cq.data ?? "");
  if (data === "noop") {
    await answer();
    return OK();
  }
  const m = data.match(/^dv:(ok|just|pend|reopen):([0-9a-f-]{36})$/);
  const msg = cq.message;
  if (!m || !msg) {
    await answer("Ação inválida", true);
    return OK();
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const envChat = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  const { data: cfg } = await admin.from("fa_owner_telegram_config").select("value").eq("key", "chat_id").maybeSingle();
  const allowedChat = cfg?.value?.from === envChat && cfg?.value?.id ? String(cfg.value.id) : envChat;
  if (String(msg.chat?.id) !== allowedChat) {
    await answer("Chat não autorizado", true);
    return OK();
  }

  const action = m[1];
  const notificationId = m[2];
  const { data: notif } = await admin
    .from("fa_kiosk_owner_notifications")
    .select("id, report_type")
    .eq("id", notificationId)
    .in("report_type", ["DIVERGENCIA_FECHAMENTO", "DIVERGENCIA_ABERTURA"])
    .maybeSingle();
  if (!notif) {
    await answer("Divergência não encontrada", true);
    return OK();
  }

  const status = STATUS_BY_ACTION[action];
  const first = String(cq.from?.first_name ?? "").trim();
  const who = first || String(cq.from?.username ?? "alguém");
  const fullName = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || cq.from?.username || null;

  const { error } = await admin.from("fa_owner_divergence_status").upsert({
    notification_id: notificationId,
    status,
    updated_by_tg_id: cq.from?.id ?? null,
    updated_by_name: fullName,
    updated_at_ms: Date.now(),
  });
  if (error) {
    console.error("Falha ao gravar status da divergência:", error.message);
    await answer("Não consegui gravar. Tente de novo.", true);
    return OK();
  }

  await api("editMessageReplyMarkup", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: { inline_keyboard: keyboardFor(notificationId, status, who, belemStamp(new Date())) },
  });
  await answer(TOAST[status]);
  return OK();
});
