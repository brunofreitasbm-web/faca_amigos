import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight, requireWebhookSecret } from "../_shared/http.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WebhookBody {
  guardian_id: string;
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
