// Disparada a cada minuto pelo pg_cron (ver migration
// 20261010120000_fa_owner_telegram.sql) — canal Telegram das notificações do
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
// Helpers inline pelo mesmo motivo das outras dispatchers: nunca é chamada
// por um navegador e o import relativo pro _shared quebrava o bundling.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TELEGRAM_MAX_TEXT = 4096;
const MAX_RETRY_AFTER_S = 10;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Corpo vem como texto simples, uma informação por linha — em geral
// "Rótulo: valor" (às vezes várias por linha atrás de um "—"). Mesma regra de
// owner-email-dispatch/formatBodyHtml, em texto para o Telegram.
function formatBody(body: string): string {
  const out: string[] = [];

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const dashSplit = line.split(" — ");
    if (dashSplit.length === 2 && dashSplit[1].includes(": ")) {
      const [prefix, rest] = dashSplit;
      out.push(`\n<b>${escapeHtml(prefix)}</b>`);
      for (const item of rest.split(", ")) {
        const idx = item.indexOf(": ");
        if (idx === -1) out.push(escapeHtml(item));
        else out.push(`${escapeHtml(item.slice(0, idx))}: <b>${escapeHtml(item.slice(idx + 2))}</b>`);
      }
      continue;
    }

    const idx = line.indexOf(": ");
    const label = idx > 0 ? line.slice(0, idx) : "";
    if (idx > 0 && idx < 40 && !label.includes(" - ")) {
      out.push(`${escapeHtml(label)}: <b>${escapeHtml(line.slice(idx + 2))}</b>`);
    } else {
      out.push(escapeHtml(line));
    }
  }

  return out.join("\n");
}

function buildMessage(title: string, body: string): string {
  const text = `<b>${escapeHtml(title)}</b>\n\n${formatBody(body)}`;
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

    const data = await res.json().catch(() => null) as { description?: string; parameters?: { retry_after?: number } } | null;
    const detail = `Telegram ${method} respondeu ${res.status}: ${data?.description ?? ""}`;

    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(data?.parameters?.retry_after ?? 1, MAX_RETRY_AFTER_S);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return { ok: false, retryable: res.status === 429 || res.status >= 500, detail };
  }
  return { ok: false, retryable: true, detail: "429 persistente" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    return jsonResponse({ error: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados" }, 500);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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

  if (rows.length === 0) return jsonResponse({ checked: 0, sent: 0, failed: 0, requeued: 0 });

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  // Motivos das falhas voltam na resposta (fica em net._http_response do pg_cron),
  // já que o log da function é difícil de consultar.
  const errors: string[] = [];

  // Em série: o Telegram limita ~20 msgs/min por grupo e a ordem importa.
  for (const row of rows) {
    const html = buildMessage(row.title, row.body);
    const payload = html
      ? { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }
      : {
        chat_id: chatId,
        text: `${row.title}\n\n${row.body}`.slice(0, TELEGRAM_MAX_TEXT),
        disable_web_page_preview: true,
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
