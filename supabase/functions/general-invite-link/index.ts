// Gera (ou devolve, se já existir) o Link Geral fixo de auto-cadastro de
// estagiário da unidade. Ao contrário de create-onboarding-invite, aqui não
// há "gerar de novo" — é idempotente por unidade, porque o Owner precisa
// poder reabrir a tela e ver o mesmo link sempre que quiser, sem invalidar
// o que já foi compartilhado.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

interface GeneralInviteLinkBody {
  unitId: string;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.employees.write");
  if (!auth.ok) return auth.response;

  let body: GeneralInviteLinkBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!body.unitId?.trim()) return jsonResponse(req, { error: "selecione uma unidade" }, 400);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: existing } = await adminClient
    .from("fa_kiosk_unit_general_invites")
    .select("token")
    .eq("unit_id", body.unitId)
    .maybeSingle();

  if (existing) return jsonResponse(req, { unitId: body.unitId, token: existing.token });

  const token = randomToken();
  const { error } = await adminClient
    .from("fa_kiosk_unit_general_invites")
    .insert({ unit_id: body.unitId, token });

  if (error) return jsonResponse(req, { error: error.message ?? "não foi possível gerar o link" }, 400);

  return jsonResponse(req, { unitId: body.unitId, token });
});
