// Anon-callable (verify_jwt = false, ver supabase/config.toml): a pessoa
// ainda não tem conta nenhuma quando abre o link de convite. Só confirma se
// o link é válido e devolve o mínimo pra tela mostrar "Convite para:
// Recepção — Unidade X" antes do formulário — não revoga nem marca nada
// como usado (isso só acontece em onboarding-complete).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { validateInvite } from "../_shared/onboardingInvite.ts";

interface InviteInfoBody {
  inviteId: string;
  token: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  let body: InviteInfoBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = await validateInvite(adminClient, body.inviteId, body.token);
  if (!result.ok) return jsonResponse(req, { error: result.error }, 401);

  const { data: units } = await adminClient
    .from("fa_kiosk_units")
    .select("name")
    .in("id", result.invite.unit_ids);

  return jsonResponse(req, {
    position: result.invite.position,
    unitNames: (units ?? []).map((u) => u.name),
    fullNameHint: result.invite.full_name_hint,
  });
});
