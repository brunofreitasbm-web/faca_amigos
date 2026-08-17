// Anon-callable (verify_jwt = false, ver supabase/config.toml): quem abre o
// Link Geral ainda não tem NENHUMA conta — só confirma se o link é válido e
// devolve o nome da unidade pra tela mostrar "Cadastro de Estagiário —
// Unidade X" antes do formulário. Mesmo espírito de onboarding-invite-info.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { validateGeneralInvite } from "../_shared/generalInvite.ts";

interface GeneralInviteInfoBody {
  unitId: string;
  token: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  let body: GeneralInviteInfoBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = await validateGeneralInvite(adminClient, body.unitId, body.token);
  if (!result.ok) return jsonResponse(req, { error: result.error }, 401);

  const { data: unit } = await adminClient
    .from("fa_kiosk_units")
    .select("name")
    .eq("id", result.unitId)
    .maybeSingle();

  return jsonResponse(req, { unitName: unit?.name ?? null });
});
