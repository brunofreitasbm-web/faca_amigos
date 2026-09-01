// Disparada 1x/dia pelo pg_cron (ver migration
// 20260831150000_fa_kiosk_ponto_photo_retention.sql) — apaga fotos de
// marcação de ponto (bucket `ponto-fotos`) com mais de 45 dias. A foto só
// serve de evidência visual pro gestor (aba Frequência); o reconhecimento
// facial já rodou no cliente antes do upload. A marcação em si (NSR, tipo,
// horário) nunca é tocada — só a foto e a referência em punch_photo_path.
//
// `fa_kiosk_ponto_photo_retention_claim` já limpa a referência no banco
// dentro da própria instrução SQL (UPDATE...RETURNING com FOR UPDATE SKIP
// LOCKED) — se o cron sobrepuser invocações, a segunda não reivindica as
// mesmas linhas. O apagamento do arquivo no Storage acontece depois, aqui;
// numa falha de rede rara, a referência já foi limpa e o arquivo fica
// órfão no bucket (sem efeito visível — a UI só lê punch_photo_path).
//
// CORS/JSON helpers inline pelo mesmo motivo de push-alert-dispatch: nunca
// é chamada por um navegador (só pelo pg_cron/pg_net), e o import relativo
// pro _shared causava falha de bundling no deploy via MCP.

import { createClient } from "jsr:@supabase/supabase-js@2";

const RETENTION_DAYS = 45;
const BATCH_SIZE = 200;
const MAX_BATCHES = 20; // teto de segurança por execução (até 4000 fotos/dia)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let claimed = 0;
  let removed = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await adminClient.rpc("fa_kiosk_ponto_photo_retention_claim", {
      p_cutoff_ms: cutoffMs,
      p_limit: BATCH_SIZE,
    });
    if (error) return jsonResponse({ error: error.message, claimed, removed, failed }, 500);

    const rows = (data ?? []) as Array<{ id: string; punch_photo_path: string }>;
    if (rows.length === 0) break;

    claimed += rows.length;
    const paths = rows.map((r) => r.punch_photo_path);
    const { data: removedFiles, error: removeError } = await adminClient.storage.from("ponto-fotos").remove(paths);
    if (removeError) {
      failed += paths.length;
    } else {
      removed += removedFiles?.length ?? 0;
      failed += paths.length - (removedFiles?.length ?? 0);
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return jsonResponse({ cutoffMs, claimed, removed, failed });
});
