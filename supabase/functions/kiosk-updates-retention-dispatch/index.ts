// Disparada pelo pg_cron para limpar APKs antigos do bucket kiosk-updates.
// Retém apenas as versões mais recentes (KEEP_LATEST_COUNT) para não estourar o limite de armazenamento.

import { createClient } from "jsr:@supabase/supabase-js@2";

const RETENTION_DAYS = 30; // Podemos usar dias ou contagem. Vamos usar contagem por segurança, mas deixamos a variável se precisar.
const KEEP_LATEST_COUNT = 3;
const BUCKET = "kiosk-updates";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Lista todos os arquivos da pasta kiosk dentro do bucket
  // (A maioria dos releases pelo script vão para a pasta kiosk/)
  const { data: files, error: listError } = await adminClient.storage.from(BUCKET).list("kiosk", {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (listError) return jsonResponse({ error: listError.message }, 500);

  // Filtra apenas APKs e ignora pastas/arquivos vazios
  const apks = (files || []).filter(f => f.name.toLowerCase().endsWith(".apk") && f.id);

  if (apks.length <= KEEP_LATEST_COUNT) {
    return jsonResponse({ 
      message: "Nenhum APK antigo para remover", 
      found: apks.length, 
      removed: 0 
    });
  }

  // Pega os arquivos que passaram do limite de retenção (os mais antigos, pois a lista já está DESC)
  const toDelete = apks.slice(KEEP_LATEST_COUNT).map(f => `kiosk/${f.name}`);

  const { data: removedFiles, error: removeError } = await adminClient.storage.from(BUCKET).remove(toDelete);

  if (removeError) {
    return jsonResponse({ error: removeError.message, attempted: toDelete }, 500);
  }

  return jsonResponse({ 
    message: "Limpeza concluída", 
    kept: KEEP_LATEST_COUNT,
    removed: removedFiles?.length ?? 0,
    removedFiles: toDelete
  });
});
