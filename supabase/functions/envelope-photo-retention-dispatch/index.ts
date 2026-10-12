// Disparada 1x/dia pelo pg_cron (ver migration
// 20261012000000_fa_envelope_photo_retention.sql) — apaga do bucket
// `envelope-fotos` as fotos de envelopes recolhidos há mais de 5 dias.
// Envelopes pendentes nunca são tocados; a sangria em si é preservada.
//
// `fa_envelope_photo_retention_claim` já limpa a referência no banco dentro da
// própria instrução SQL (FOR UPDATE SKIP LOCKED), então execuções sobrepostas
// não reivindicam as mesmas linhas. Se a remoção no Storage falhar, o arquivo
// fica órfão (sem efeito visível — a UI só lê photo_url).
//
// Helpers inline (sem import do _shared) pelo mesmo motivo de
// ponto-photo-retention-dispatch: nunca é chamada por navegador.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "envelope-fotos";
const RETENTION_DAYS = 5;
const BATCH_SIZE = 200;
const MAX_BATCHES = 20;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// photo_url guarda a URL pública completa; o Storage remove por caminho no bucket.
function pathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
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
    const { data, error } = await adminClient.rpc("fa_envelope_photo_retention_claim", {
      p_cutoff_ms: cutoffMs,
      p_limit: BATCH_SIZE,
    });
    if (error) return jsonResponse({ error: error.message, claimed, removed, failed }, 500);

    const rows = (data ?? []) as Array<{ id: string; photo_url: string }>;
    if (rows.length === 0) break;

    claimed += rows.length;
    const paths = rows.map((r) => pathFromPublicUrl(r.photo_url)).filter((p): p is string => p !== null);
    failed += rows.length - paths.length;

    if (paths.length > 0) {
      const { data: removedFiles, error: removeError } = await adminClient.storage.from(BUCKET).remove(paths);
      if (removeError) {
        failed += paths.length;
      } else {
        removed += removedFiles?.length ?? 0;
        failed += paths.length - (removedFiles?.length ?? 0);
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return jsonResponse({ cutoffMs, claimed, removed, failed });
});
