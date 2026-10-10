// Disparada a cada minuto pelo pg_cron (ver migration
// 20261010042613_fa_owner_telegram.sql) — canal Telegram das notificações do
// Owner, irmã de owner-email-dispatch e owner-report-dispatch.
// `fa_owner_telegram_claim_due` marca as notificações como enviadas dentro da
// mesma instrução SQL (UPDATE...RETURNING), então invocações sobrepostas do
// cron não pegam as mesmas linhas.
//
// Diferente do e-mail, uma falha transitória (rede, 429, 5xx) devolve a
// notificação à fila (telegram_sent_at_ms = null) para a próxima rodada.
// Falha permanente (4xx que não seja 429 — chat inválido, texto recusado) não
// é reenfileirada, para não repetir a mesma mensagem a cada minuto.
//
// Secrets: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (grupo/chat do Owner).
//
// Layout das mensagens por tipo em ./format.ts (puro, testado com Node). O
// import é do mesmo diretório; só o ../_shared quebrava o bundling no deploy.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { BUTTON_TYPES, divergenceKeyboard, secretFingerprint, webhookSecret } from "./buttons.ts";
import { formatMessage } from "./format.ts";

const TELEGRAM_MAX_TEXT = 4096;
const MAX_RETRY_AFTER_S = 10;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function buildMessage(reportType: string, title: string, body: string): string {
  const text = formatMessage(reportType, title, body);
  if (text.length <= TELEGRAM_MAX_TEXT) return text;
  // Corte por caractere pode partir uma tag aberta; cai para texto puro
  // truncado, que o Telegram aceita sem parse_mode.
  return "";
}

type TelegramResult = { ok: true } | { ok: false; retryable: boolean; detail: string };

async function telegramCall(
  token: string,
  method: "sendMessage" | "sendPhoto",
  payload: Record<string, unknown>,
): Promise<TelegramResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { ok: false, retryable: true, detail: `rede: ${String(e)}` };
    }
    if (res.ok) return { ok: true };

    const data = await res.json().catch(() => null) as
      | { description?: string; parameters?: { retry_after?: number; migrate_to_chat_id?: number } }
      | null;
    // Grupo promovido a supergrupo: o chat_id antigo morre e o Telegram informa o novo.
    // Fica na resposta do cron e a notificação volta à fila até o secret ser corrigido.
    const migrateTo = data?.parameters?.migrate_to_chat_id;
    const detail = `Telegram ${method} respondeu ${res.status}: ${data?.description ?? ""}` +
      (migrateTo ? ` — novo TELEGRAM_CHAT_ID: ${migrateTo}` : "");

    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(data?.parameters?.retry_after ?? 1, MAX_RETRY_AFTER_S);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return { ok: false, retryable: res.status === 429 || res.status >= 500 || Boolean(migrateTo), detail };
  }
  return { ok: false, retryable: true, detail: "429 persistente" };
}

/**
 * Garante que o bot entrega os cliques dos botões ao owner-telegram-webhook.
 * Idempotente: a impressão digital do segredo (derivado do token do bot) fica
 * em fa_owner_telegram_config('webhook'); só chama setWebhook quando ela não
 * bate, ou seja, na primeira vez e a cada troca do TELEGRAM_BOT_TOKEN.
 * Nunca derruba o envio: devolve o motivo da falha (ou null).
 */
async function ensureWebhook(
  // deno-lint-ignore no-explicit-any
  admin: any,
  token: string,
  supabaseUrl: string,
): Promise<string | null> {
  try {
    const secret = await webhookSecret(token);
    const fp = await secretFingerprint(secret);
    const { data: cfg } = await admin.from("fa_owner_telegram_config").select("value").eq("key", "webhook").maybeSingle();
    if (cfg?.value?.secret_fp === fp) return null;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${supabaseUrl}/functions/v1/owner-telegram-webhook`,
        secret_token: secret,
        allowed_updates: ["callback_query"],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { description?: string } | null;
      return `setWebhook ${res.status}: ${data?.description ?? ""}`.slice(0, 200);
    }
    const { error } = await admin.from("fa_owner_telegram_config").upsert({
      key: "webhook",
      value: { version: "1", set_at_ms: Date.now(), secret_fp: fp },
      updated_at_ms: Date.now(),
    });
    return error ? `config webhook: ${error.message}`.slice(0, 200) : null;
  } catch (e) {
    return `ensureWebhook: ${String(e)}`.slice(0, 200);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    return jsonResponse({ error: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Antes de enviar: os botões só funcionam com o webhook registrado.
  const webhookError = await ensureWebhook(adminClient, token, supabaseUrl);

  const { data: due, error } = await adminClient.rpc("fa_owner_telegram_claim_due", { p_now_ms: Date.now() });
  if (error) return jsonResponse({ error: error.message }, 500);

  const rows = ((due ?? []) as Array<{
    notification_id: string;
    report_type: string;
    title: string;
    body: string;
    photo_url: string | null;
    due_at_ms: number;
  }>).sort((a, b) => a.due_at_ms - b.due_at_ms);

  if (rows.length === 0) {
    return jsonResponse({ checked: 0, sent: 0, failed: 0, requeued: 0, ...(webhookError ? { webhook: webhookError } : {}) });
  }

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  // Motivos das falhas voltam na resposta (fica em net._http_response do pg_cron),
  // já que o log da function é difícil de consultar.
  const errors: string[] = [];
  if (webhookError) errors.push(`webhook: ${webhookError}`);

  // Em série: o Telegram limita ~20 msgs/min por grupo e a ordem importa.
  for (const row of rows) {
    const html = buildMessage(row.report_type, row.title, row.body);
    // Divergências levam os botões Conferido / Pedir justificativa / Pendência.
    const markup = BUTTON_TYPES.has(row.report_type) ? { reply_markup: divergenceKeyboard(row.notification_id) } : {};
    const payload = html
      ? { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...markup }
      : {
        chat_id: chatId,
        text: `${row.title}\n\n${row.body}`.slice(0, TELEGRAM_MAX_TEXT),
        disable_web_page_preview: true,
        ...markup,
      };

    const result = await telegramCall(token, "sendMessage", payload);
    if (!result.ok) {
      failed++;
      console.error(`Falha ao enviar ${row.report_type} (${row.notification_id}) ao Telegram:`, result.detail);
      errors.push(`${row.report_type}: ${result.retryable ? "retry" : "perm"} ${result.detail}`.slice(0, 200));
      if (result.retryable) {
        const { error: requeueError } = await adminClient
          .from("fa_kiosk_owner_notifications")
          .update({ telegram_sent_at_ms: null })
          .eq("id", row.notification_id);
        if (requeueError) {
          console.error("Falha ao reenfileirar:", requeueError.message);
          errors.push(`requeue: ${requeueError.message}`.slice(0, 200));
        } else requeued++;
      }
      continue;
    }
    sent++;

    // A foto do envelope vai em seguida; falha aqui não reenvia o texto.
    if (row.photo_url) {
      const photo = await telegramCall(token, "sendPhoto", {
        chat_id: chatId,
        photo: row.photo_url,
        caption: "Foto do envelope",
      });
      if (!photo.ok) console.error(`Falha ao enviar foto de ${row.notification_id}:`, photo.detail);
    }
  }

  return jsonResponse({ checked: rows.length, sent, failed, requeued, ...(errors.length ? { errors: errors.slice(0, 5) } : {}) });
});
