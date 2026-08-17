import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS/JSON/segredo de webhook inline em vez de importar ../_shared/http.ts
// — mesmo motivo de push-alert-dispatch/owner-report-dispatch: o import
// relativo pro _shared causa falha de bundling no deploy via MCP (o
// arquivo fica fora da raiz enviada para a function).
const FALLBACK_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://kiosk-ui.vercel.app",
  "https://app.institutofacaamigos.com.br",
  "http://127.0.0.1:7317",
  "https://127.0.0.1:7317",
];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("FUNCTIONS_ALLOWED_ORIGINS");
  if (!raw) return FALLBACK_ORIGINS;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0]!,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  return null;
}

function requireWebhookSecret(req: Request, envVarName: string): Response | null {
  const expected = Deno.env.get(envVarName);
  if (!expected) {
    console.error(`${envVarName} não configurado — recusando chamada por padrão seguro`);
    return jsonResponse(req, { error: "webhook não configurado" }, 503);
  }
  const provided = req.headers.get("x-webhook-secret");
  if (provided !== expected) {
    return jsonResponse(req, { error: "não autorizado" }, 401);
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WebhookBody {
  guardian_id: string;
  // Opcionais — caller antigo (só cupom de 5 estrelas) não manda nenhum
  // dos dois. Quando `rating` vem preenchido e <= 3, a avaliação é só
  // registrada (fa_kiosk_google_reviews, trigger notifica o Owner) e o
  // fluxo de cupom abaixo é pulado — nota baixa não ganha desconto.
  rating?: number;
  comment?: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const secretRejection = requireWebhookSecret(req, "GOOGLE_REVIEW_WEBHOOK_SECRET");
  if (secretRejection) return secretRejection;

  let body: WebhookBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  if (!body.guardian_id || !UUID_RE.test(body.guardian_id)) {
    return jsonResponse(req, { error: "guardian_id inválido" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: guardianData, error: guardianError } = await adminClient
    .from("fa_kiosk_guardians")
    .select("id")
    .eq("id", body.guardian_id)
    .maybeSingle();

  if (guardianError) {
    return jsonResponse(req, { error: "erro ao verificar responsável" }, 500);
  }
  if (!guardianData) {
    return jsonResponse(req, { error: "responsável não encontrado" }, 404);
  }

  const { data: unitData, error: unitError } = await adminClient
    .from("fa_kiosk_units")
    .select("id")
    .ilike("name", "%Circuito%")
    .limit(1)
    .maybeSingle();

  if (unitError) {
    return jsonResponse(req, { error: "erro ao buscar unidade" }, 500);
  }

  if (!unitData) {
    return jsonResponse(req, { error: "unidade circuito não encontrada" }, 404);
  }

  const rating = typeof body.rating === "number" ? Math.round(body.rating) : null;
  if (rating !== null && (rating < 1 || rating > 5)) {
    return jsonResponse(req, { error: "rating inválido" }, 400);
  }

  if (rating !== null && rating <= 3) {
    const { error: reviewError } = await adminClient.from("fa_kiosk_google_reviews").insert({
      unit_id: unitData.id,
      guardian_id: body.guardian_id,
      rating,
      comment: body.comment ?? null,
    });
    if (reviewError) {
      console.error("Erro ao registrar avaliação:", reviewError);
      return jsonResponse(req, { error: "falha ao registrar avaliação" }, 500);
    }
    return jsonResponse(req, { success: true, message: "Avaliação registrada." });
  }

  const code = `5STARS_${body.guardian_id.substring(0, 8).toUpperCase()}`;

  const { error: insertError } = await adminClient
    .from("fa_kiosk_coupons")
    .upsert(
      {
        unit_id: unitData.id,
        code: code,
        kind: "DESCONTO_PCT",
        value: 10,
        max_uses: 1,
        used_count: 0,
        active: true,
        description: "10% desconto - 5 Avaliação Google"
      },
      { onConflict: "unit_id, code" }
    );

  if (insertError) {
    console.error("Erro ao inserir cupom:", insertError);
    return jsonResponse(req, { error: "falha ao criar cupom" }, 500);
  }

  return jsonResponse(req, { success: true, message: "Cupom gerado com sucesso!", code });
});
