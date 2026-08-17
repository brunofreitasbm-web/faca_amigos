// Anon-callable (verify_jwt = false, ver supabase/config.toml): consome o
// Link Geral da unidade e cria o colaborador do zero — conta em
// auth.users, linha em fa_kiosk_employees, PIN e unidade. Papel é SEMPRE
// ESTAGIARIO e fica ativo imediatamente (sem aprovação prévia — decisão de
// produto: o link só deve ser divulgado a quem já foi combinado presencialmente,
// então a barreira é o token, não uma fila de revisão). Espelha
// onboarding-complete, mas sem invite_id (o token identifica a UNIDADE, não
// uma pessoa), sem revalidar `used_at`/expiração (reutilizável por
// definição) e sem dados de RH completos — o Link Geral pede só o essencial,
// o resto quem cadastra pode completar depois pelo próprio perfil.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { validateGeneralInvite } from "../_shared/generalInvite.ts";

const PIN_PATTERN = /^\d{6}$/;

interface CompleteBody {
  unitId: string;
  token: string;
  fullName: string;
  cpf?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  pin: string;
}

function randomInternalPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

function nullIfEmpty(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  let body: CompleteBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  if (!body.fullName?.trim() || body.fullName.trim().length < 2) {
    return jsonResponse(req, { error: "informe o nome completo" }, 400);
  }
  if (!PIN_PATTERN.test(body.pin ?? "")) {
    return jsonResponse(req, { error: "o PIN precisa ter exatamente 6 dígitos" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = await validateGeneralInvite(adminClient, body.unitId, body.token);
  if (!result.ok) return jsonResponse(req, { error: result.error }, 401);

  const syntheticEmail = `employee-${crypto.randomUUID()}@kiosk.internal`;
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email: syntheticEmail,
    password: randomInternalPassword(),
    email_confirm: true,
  });
  if (createUserError || !createdUser.user) {
    return jsonResponse(req, { error: createUserError?.message ?? "não foi possível criar a conta de login" }, 400);
  }

  const { data: employeeRow, error: insertError } = await adminClient
    .from("fa_kiosk_employees")
    .insert({
      auth_user_id: createdUser.user.id,
      full_name: body.fullName.trim(),
      role: "ESTAGIARIO",
      position: "Estagiário",
      contract_type: "ESTAGIO",
      admission_date: new Date().toISOString().slice(0, 10),
      cpf: nullIfEmpty(body.cpf)?.replace(/\D/g, "") || null,
      cpf_last4: nullIfEmpty(body.cpf)?.replace(/\D/g, "").slice(-4) || null,
      email: nullIfEmpty(body.email)?.toLowerCase() ?? null,
      phone: nullIfEmpty(body.phone)?.replace(/\D/g, "") || null,
      birth_date: body.birthDate || null,
    })
    .select("id")
    .single();

  if (insertError || !employeeRow) {
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    return jsonResponse(req, { error: insertError?.message ?? "não foi possível salvar o colaborador" }, 400);
  }

  const { error: credentialsError } = await adminClient.from("fa_kiosk_local_credentials").insert({
    employee_id: employeeRow.id,
    pin_hash: bcrypt.hashSync(body.pin, 10),
  });
  if (credentialsError) {
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    await adminClient.from("fa_kiosk_employees").delete().eq("id", employeeRow.id);
    return jsonResponse(req, { error: "não foi possível salvar o PIN" }, 400);
  }

  await adminClient.from("fa_kiosk_employee_units").insert({ employee_id: employeeRow.id, unit_id: result.unitId });

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_EMPLOYEE_GENERAL_INVITE_COMPLETE",
    severity: "ALERTA",
    details_json: { employeeId: employeeRow.id, unitId: result.unitId },
  });

  return jsonResponse(req, { id: employeeRow.id });
});
