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
        ...(row.photo_url
          ? {
              html:
                `<pre style="font-family: inherit; white-space: pre-wrap; font-size: 14px;">${escapeHtml(row.body)}</pre>` +
                `<p><img src="${row.photo_url}" alt="Foto do envelope" style="max-width: 480px; width: 100%; border-radius: 8px;" /></p>`,
            }
          : {}),
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
