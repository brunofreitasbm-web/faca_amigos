// Gera um link de convite individual para um novo colaborador se
// autocadastrar do zero (nome, PIN, documentos, endereço, Pix — tudo),
// sem precisar de nenhuma conta prévia. Quem decide função/papel, cargo,
// unidade(s) e data de admissão é SEMPRE quem gera o convite aqui — nunca
// quem preenche depois, o que evita que um link vazado vire uma forma de
// autopromoção a um nível de acesso maior.
//
// Só o hash do token é gravado (bcrypt, mesmo padrão do PIN em
// admin-create-employee); o token em si só existe nesta resposta, uma
// única vez — o front monta o link `${origin}/?convite=${inviteId}.${token}`
// e é responsabilidade de quem manda o link não vazá-lo por um canal
// inseguro.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

const ROLES = ["ESTAGIARIO", "OPERADOR", "GERENTE", "ADMIN"];
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000;

interface CreateInviteBody {
  role: string;
  position: string;
  unitIds: string[];
  fullNameHint?: string;
  admissionDate?: string;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.employees.write");
  if (!auth.ok) return auth.response;

  let body: CreateInviteBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  if (!body.position?.trim()) return jsonResponse(req, { error: "informe o cargo/função" }, 400);
  if (!ROLES.includes(body.role)) return jsonResponse(req, { error: "papel inválido" }, 400);
  if (!Array.isArray(body.unitIds) || body.unitIds.length === 0) {
    return jsonResponse(req, { error: "selecione ao menos uma unidade" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Quem gera o convite precisa corresponder a um employee_id real, para o
  // audit trail — resolvido aqui (service role) a partir do auth.uid() já
  // conferido pelo requireCapability.
  const { data: creator } = await adminClient
    .from("fa_kiosk_employees")
    .select("id")
    .eq("auth_user_id", auth.userId)
    .maybeSingle();

  const token = randomToken();
  const nowMs = Date.now();

  const { data: invite, error } = await adminClient
    .from("fa_kiosk_onboarding_invites")
    .insert({
      token_hash: bcrypt.hashSync(token, 10),
      role: body.role,
      position: body.position.trim(),
      unit_ids: body.unitIds,
      full_name_hint: body.fullNameHint?.trim() || null,
      admission_date: body.admissionDate || null,
      created_by_employee_id: creator?.id ?? null,
      expires_at_ms: nowMs + EXPIRES_IN_MS,
    })
    .select("id")
    .single();

  if (error || !invite) {
    return jsonResponse(req, { error: error?.message ?? "não foi possível gerar o convite" }, 400);
  }

  return jsonResponse(req, { inviteId: invite.id, token, expiresAtMs: nowMs + EXPIRES_IN_MS });
});
