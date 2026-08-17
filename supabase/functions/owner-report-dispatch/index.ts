// Disparada a cada minuto pelo pg_cron (ver migration
// 20260818000001_fa_kiosk_owner_reports.sql) — gêmea de
// push-alert-dispatch, mas para os relatórios do Owner (abertura,
// acompanhamento 17h/20h, fechamento) em vez do alerta de fim de sessão
// do responsável. `fa_owner_push_claim_due` já marca as notificações
// como enviadas dentro da mesma instrução SQL (UPDATE...RETURNING numa
// CTE) e replica para todos os dispositivos do Owner inscritos — se o
// cron sobrepuser invocações, a segunda não pega as mesmas linhas.
//
// CORS/JSON helpers inline pelo mesmo motivo de push-alert-dispatch:
// nunca é chamada por um navegador (só pelo pg_cron/pg_net), e o import
// relativo pro _shared causava falha de bundling no deploy via MCP.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BJhjx5DI70O6oFStbFYAlrCWwMmrg098IfyJh2CVsbQsAc-4WTRCAvo4TDNbem3xCk4IhxDMYSiJNNGCD_7KYnY";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKey) {
    return jsonResponse({ error: "VAPID_PRIVATE_KEY não configurada" }, 500);
  }
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@facaamigos.com.br";
  webpush.setVapidDetails(vapidSubject, VAPID_PUBLIC_KEY, vapidPrivateKey);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowMs = Date.now();
  const { data: due, error } = await adminClient.rpc("fa_owner_push_claim_due", { p_now_ms: nowMs });
  if (error) return jsonResponse({ error: error.message }, 500);

  const rows = (due ?? []) as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
    title: string;
    body: string;
  }>;

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ title: row.title, body: row.body, url: "/gerencial" }),
      ),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  return jsonResponse({ checked: rows.length, sent: rows.length - failed, failed });
});
