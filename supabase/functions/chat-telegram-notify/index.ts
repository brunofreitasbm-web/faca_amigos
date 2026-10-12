import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  formatEmployeeMessage,
  quickReplyKeyboard,
  REACTION_READ,
  type ChatContext,
} from "../_shared/chatTelegram.ts";

// Bot de chat interno (separado do bot do caixa). Três usos, todos por POST sem JWT
// (verify_jwt=false, ver config.toml; a segurança é o claim atômico no banco, que só
// libera mensagens existentes e ainda não avisadas):
//   { message_id }      -> trigger do banco: avisa o dono de uma mensagem nova
//   {}                  -> varredura do cron: reenvia o que falhou e garante o webhook
//   { read_thread_id }  -> colaborador leu: troca a reação das respostas do dono para 👀
// Secrets: CHAT_TELEGRAM_BOT_TOKEN e CHAT_TELEGRAM_CHAT_ID (id do grupo dos admins, ou do chat direto).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type TgResult = { ok: true; data: any } | { ok: false; retryable: boolean; detail: string };

async function tg(token: string, method: string, payload: Record<string, unknown>): Promise<TgResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) return { ok: true, data: data.result };
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500,
      detail: `${method} ${res.status}: ${data?.description ?? ""}`.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, retryable: true, detail: `${method}: ${String(e)}`.slice(0, 200) };
  }
}

async function sha256Hex(s: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Registra o webhook na 1ª execução e sempre que token/URL/updates mudarem. O
// segredo do webhook é o mesmo derivado em chat-telegram-webhook.
async function ensureWebhook(admin: any, token: string, supabaseUrl: string): Promise<string | null> {
  const url = `${supabaseUrl}/functions/v1/chat-telegram-webhook`;
  const updates = ["message", "callback_query"];
  const fp = await sha256Hex(`${token}|${url}|${updates.join(",")}`);
  const { data: cfg } = await admin.from("fa_chat_config").select("value").eq("key", "webhook_fp").maybeSingle();
  if (cfg?.value === fp) return null;
  const secret = await sha256Hex(`${token}:chat-telegram-webhook`);
  const r = await tg(token, "setWebhook", { url, secret_token: secret, allowed_updates: updates });
  if (!r.ok) return r.detail;
  await admin.from("fa_chat_config").upsert({ key: "webhook_fp", value: fp });
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const token = Deno.env.get("CHAT_TELEGRAM_BOT_TOKEN");
  // Destino: grupo dos admins (id negativo) ou conversa direta. OWNER_ID fica como alias antigo.
  const ownerTgId = Deno.env.get("CHAT_TELEGRAM_CHAT_ID") ?? Deno.env.get("CHAT_TELEGRAM_OWNER_ID");
  // Sem secrets nada é reivindicado: as mensagens ficam no banco e saem quando configurar.
  if (!token || !ownerTgId) return json({ error: "not configured" }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({})) as { message_id?: string; read_thread_id?: string };

  const uuid = /^[0-9a-f-]{36}$/;

  // --- colaborador leu: 👀 nas respostas do dono ---
  if (body.read_thread_id) {
    if (!uuid.test(body.read_thread_id)) return json({ error: "bad id" }, 400);
    const { data: rows, error } = await admin.rpc("fa_chat_claim_read_reactions", { p_thread_id: body.read_thread_id });
    if (error) return json({ error: error.message }, 500);
    let reacted = 0;
    for (const m of (rows ?? []) as Array<{ id: string; telegram_message_id: number }>) {
      const r = await tg(token, "setMessageReaction", {
        chat_id: ownerTgId,
        message_id: m.telegram_message_id,
        reaction: [{ type: "emoji", emoji: REACTION_READ }],
      });
      if (r.ok) reacted++;
      else {
        console.error("reação de leitura falhou:", r.detail);
        // devolve o claim para a próxima leitura tentar de novo, se for transitório
        if (r.retryable) await admin.from("fa_kiosk_chat_messages").update({ telegram_read_reacted_at_ms: null }).eq("id", m.id);
      }
    }
    return json({ reacted });
  }

  // --- aviso de mensagem nova / varredura ---
  let webhookError: string | null = null;
  if (!body.message_id) webhookError = await ensureWebhook(admin, token, supabaseUrl);
  if (body.message_id && !uuid.test(body.message_id)) return json({ error: "bad id" }, 400);

  const { data: claimed, error } = await admin.rpc("fa_chat_claim_unsent", { p_id: body.message_id ?? null });
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  const errors: string[] = webhookError ? [`webhook: ${webhookError}`] : [];
  const unclaim = (id: string) =>
    admin.from("fa_kiosk_chat_messages").update({ telegram_claimed_at_ms: null }).eq("id", id);

  for (const m of (claimed ?? []) as Array<{
    id: string; thread_id: string; sender_employee_id: string; body: string;
    attachment_path: string | null; context: ChatContext | null;
  }>) {
    const { data: emp } = await admin.from("fa_kiosk_employees").select("full_name").eq("id", m.sender_employee_id).maybeSingle();
    let unitName: string | null = null;
    if (m.context?.unit_id) {
      const { data: u } = await admin.from("fa_kiosk_units").select("name").eq("id", m.context.unit_id).maybeSingle();
      unitName = u?.name ?? null;
    }

    // Imagem primeiro e o texto (com os botões) por último: é a mensagem que o dono
    // naturalmente responde, e é a que fica ligada à conversa.
    if (m.attachment_path) {
      const { data: signed } = await admin.storage.from("fa-chat-attachments").createSignedUrl(m.attachment_path, 300);
      if (signed?.signedUrl) {
        const p = await tg(token, "sendPhoto", { chat_id: ownerTgId, photo: signed.signedUrl });
        if (!p.ok) {
          errors.push(p.detail);
          if (p.retryable) { await unclaim(m.id); continue; }
        }
      }
    }

    const r = await tg(token, "sendMessage", {
      chat_id: ownerTgId,
      text: formatEmployeeMessage({
        employeeName: emp?.full_name ?? "Colaborador",
        unitName,
        context: m.context,
        body: m.body,
        hasAttachment: !!m.attachment_path,
      }),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: quickReplyKeyboard(m.id),
    });
    if (!r.ok) {
      console.error(`chat ${m.id}:`, r.detail);
      errors.push(r.detail);
      if (r.retryable) await unclaim(m.id);
      continue;
    }
    const { error: upErr } = await admin
      .from("fa_kiosk_chat_messages")
      .update({ telegram_message_id: r.data.message_id, telegram_sent_at_ms: Date.now() })
      .eq("id", m.id);
    if (upErr) errors.push(`update: ${upErr.message}`);
    else sent++;
  }

  return json({ checked: (claimed ?? []).length, sent, ...(errors.length ? { errors: errors.slice(0, 5) } : {}) });
});
