// Disparada a cada minuto pelo pg_cron (ver migration
// 20260810000001_fa_push_alertas.sql) — não tem usuário do outro lado,
// é a peça de servidor que resolve o problema de "o responsável não vai
// ficar com a tela do ?acompanhar= aberta": em vez de um setTimeout no
// navegador (que morre se a aba fecha), o alerta é computado e guardado
// no banco no momento da inscrição (fa_acompanhar_registrar_push), e
// este cron entrega via Web Push assim que vence, com o app fechado.
//
// `fa_push_claim_due` já marca as linhas como enviadas dentro da mesma
// instrução SQL (UPDATE...RETURNING) — se o cron sobrepuser invocações,
// a segunda não pega as mesmas inscrições.
//
// CORS/JSON helpers inline (em vez de importar ../_shared/http.ts como as
// outras functions) — esta function nunca é chamada por um navegador
// (só pelo pg_cron/pg_net), e o import relativo pro _shared causava falha
// de bundling no deploy via MCP.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Chave pública VAPID — não é segredo, o mesmo valor está embutido no
// client (apps/kiosk-ui/src/lib/push.ts) para abrir a inscrição no navegador.
const VAPID_PUBLIC_KEY = "BJhjx5DI70O6oFStbFYAlrCWwMmrg098IfyJh2CVsbQsAc-4WTRCAvo4TDNbem3xCk4IhxDMYSiJNNGCD_7KYnY";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKey) {
    // Sem a chave privada (ainda não configurada como secret da function),
    // não dá pra assinar o push — falha visível nos logs em vez de
    // silenciosa, mas não derruba o cron (ele só vai tentar de novo no
    // próximo minuto).
    return jsonResponse({ error: "VAPID_PRIVATE_KEY não configurada" }, 500);
  }
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@facaamigos.com.br";
  webpush.setVapidDetails(vapidSubject, VAPID_PUBLIC_KEY, vapidPrivateKey);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowMs = Date.now();
  const { data: due, error } = await adminClient.rpc("fa_push_claim_due", { p_now_ms: nowMs });
  if (error) return jsonResponse({ error: error.message }, 500);

  const rows = (due ?? []) as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
    access_code: string;
    child_first_name: string | null;
  }>;

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({
          title: "Faça Amigos",
          body: row.child_first_name
            ? `${row.child_first_name} está quase completando o tempo — dá uma olhadinha no painel!`
            : "Falta pouco tempo — dá uma olhadinha no painel!",
          url: `/?acompanhar=${row.access_code}`,
        }),
      ),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  return jsonResponse({ checked: rows.length, sent: rows.length - failed, failed });
});
