// Disparada a cada minuto pelo pg_cron (ver migration
// 20260829000003_fa_owner_email_notifications.sql) — canal de e-mail dos
// relatórios de Abertura/Fechamento de caixa do Owner, irmã de
// owner-report-dispatch (que cobre o canal push). `fa_owner_email_claim_due`
// já marca as notificações como enviadas dentro da mesma instrução SQL
// (UPDATE...RETURNING numa CTE) e replica para todo ADMIN com e-mail
// cadastrado — se o cron sobrepuser invocações, a segunda não pega as
// mesmas linhas.
//
// Remetente fixo hub.operacao.lojas@gmail.com via Gmail SMTP — GMAIL_USER
// e GMAIL_APP_PASSWORD já cadastrados como secrets da Edge Function.
//
// CORS/JSON helpers inline pelo mesmo motivo de owner-report-dispatch:
// nunca é chamada por um navegador (só pelo pg_cron/pg_net), e o import
// relativo pro _shared causava falha de bundling no deploy via MCP.

import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Corpo vem como texto simples, uma informação por linha — em geral
// "Rótulo: valor" (às vezes várias por linha, separadas por vírgula, atrás
// de um "—", ex. o detalhamento de formas de pagamento). Poucas linhas são
// frase corrida (ex. "Fulano abriu o caixa às 10:11", "Fulano - Data: ...")
// — essas viram parágrafo em vez de linha rótulo/valor.
function formatBodyHtml(body: string): string {
  const blocks: string[] = [];

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // "Detalhamento faturado — Dinheiro: R$.., Crédito: R$.., ..." — título
    // curto + lista de rótulo/valor compacta.
    const dashSplit = line.split(" — ");
    if (dashSplit.length === 2 && dashSplit[1].includes(": ")) {
      const [prefix, rest] = dashSplit;
      const items = rest
        .split(", ")
        .map((item) => {
          const idx = item.indexOf(": ");
          if (idx === -1) return `<div style="padding:2px 0;">${escapeHtml(item)}</div>`;
          const label = item.slice(0, idx);
          const value = item.slice(idx + 2);
          return (
            `<tr><td style="padding:3px 14px 3px 0; color:#6b7280; white-space:nowrap;">${escapeHtml(label)}</td>` +
            `<td style="padding:3px 0; font-weight:600; color:#111827;">${escapeHtml(value)}</td></tr>`
          );
        })
        .join("");
      blocks.push(
        `<p style="margin:18px 0 6px; font-size:13px; font-weight:600; color:#374151; text-transform:uppercase; letter-spacing:.03em;">${escapeHtml(prefix)}</p>` +
          `<table style="border-collapse:collapse; font-size:14px;">${items}</table>`,
      );
      continue;
    }

    const idx = line.indexOf(": ");
    const label = idx > 0 ? line.slice(0, idx) : "";
    // Linha "Rótulo: valor" só quando o rótulo é curto e não é o começo de
    // uma frase (ex. "Fulano - Data: ...", que tem " - " no meio).
    if (idx > 0 && idx < 40 && !label.includes(" - ")) {
      const value = line.slice(idx + 2);
      blocks.push(
        `<div style="display:flex; justify-content:space-between; gap:16px; padding:7px 0; border-bottom:1px solid #f3f4f6; font-size:14px;">` +
          `<span style="color:#6b7280;">${escapeHtml(label)}</span>` +
          `<span style="font-weight:600; color:#111827; text-align:right;">${escapeHtml(value)}</span>` +
          `</div>`,
      );
    } else {
      blocks.push(`<p style="margin:0 0 12px; font-size:14px; color:#374151;">${escapeHtml(line)}</p>`);
    }
  }

  return blocks.join("\n");
}

function buildHtmlEmail(title: string, body: string, photoUrl: string | null): string {
  const photoHtml = photoUrl
    ? `<div style="margin-top:20px;">` +
      `<p style="margin:0 0 8px; font-size:12px; color:#9ca3af; text-transform:uppercase; letter-spacing:.03em;">Foto do envelope</p>` +
      `<img src="${photoUrl}" alt="Foto do envelope" style="max-width:200px; width:100%; border-radius:8px; border:1px solid #e5e7eb;" />` +
      `</div>`
    : "";

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:24px; color:#111827;">` +
    `<h2 style="margin:0 0 18px; font-size:17px; font-weight:700; color:#111827;">${escapeHtml(title)}</h2>` +
    formatBodyHtml(body) +
    photoHtml +
    `</div>`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailAppPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailAppPassword) {
    return jsonResponse({ error: "GMAIL_USER/GMAIL_APP_PASSWORD não configurados" }, 500);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowMs = Date.now();
  const { data: due, error } = await adminClient.rpc("fa_owner_email_claim_due", { p_now_ms: nowMs });
  if (error) return jsonResponse({ error: error.message }, 500);

  const rows = (due ?? []) as Array<{
    notification_id: string;
    title: string;
    body: string;
    recipient_email: string;
    photo_url: string | null;
  }>;

  if (rows.length === 0) return jsonResponse({ checked: 0, sent: 0, failed: 0 });

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  const results = await Promise.allSettled(
    rows.map((row) =>
      transporter.sendMail({
        from: `"Façaamigos" <${gmailUser}>`,
        to: row.recipient_email,
        subject: row.title,
        text: row.body,
        html: buildHtmlEmail(row.title, row.body, row.photo_url),
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(`Falha ao enviar e-mail para ${rows[i]!.recipient_email}:`, result.reason);
    }
  }

  return jsonResponse({ checked: rows.length, sent: rows.length - failed, failed });
});
