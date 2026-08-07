// CORS e resposta JSON compartilhados pelas Edge Functions.
//
// A origem permitida vem de FUNCTIONS_ALLOWED_ORIGINS (lista separada por
// vírgula, ex.: "https://kiosk.facaamigos.com.br,http://localhost:5173").
// Trocar o `*` que estava fixo nas três funções por uma allowlist é o que
// impede login-pin de ser martelado a partir de qualquer página aberta no
// navegador de qualquer pessoa. Sem a variável configurada, cai em
// localhost — falha fechado, e o erro aparece em homologação, não em
// produção com a porta aberta.

const FALLBACK_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("FUNCTIONS_ALLOWED_ORIGINS");
  if (!raw) return FALLBACK_ORIGINS;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  return {
    // Origem não permitida recebe um header que o navegador recusa — a
    // resposta até existe, mas o JS da página nunca a lê.
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0]!,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  return null;
}
