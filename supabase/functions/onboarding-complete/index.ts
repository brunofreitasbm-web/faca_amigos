// Anon-callable (verify_jwt = false, ver supabase/config.toml): consome um
// convite de cadastro e cria o colaborador do zero — conta em auth.users,
// linha em fa_kiosk_employees, PIN, unidade(s), e os dados de RH que a
// pessoa preencheu (fa_kiosk_employee_personal_info + pix). Revalida o
// convite do mesmo jeito que onboarding-invite-info — nunca confia que ela
// rodou antes. Espelha admin-create-employee/index.ts na criação da conta,
// mas função/cargo/unidade(s)/admissão vêm do CONVITE, nunca do corpo desta
// requisição — quem decide isso é sempre quem gerou o link.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { validateInvite } from "../_shared/onboardingInvite.ts";

const PIN_PATTERN = /^\d{6}$/;

interface PersonalInfoInput {
  ctpsNumero?: string;
  ctpsSerie?: string;
  ctpsUf?: string;
  rgNumero?: string;
  rgOrgaoEmissor?: string;
  nomeMae?: string;
  nomePai?: string;
  estadoCivil?: string;
  escolaridade?: string;
  racaCor?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

interface CompleteBody {
  inviteId: string;
  token: string;
  fullName: string;
  cpf?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  pin: string;
  personalInfo?: PersonalInfoInput;
  pixKey?: string;
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

  const result = await validateInvite(adminClient, body.inviteId, body.token);
  if (!result.ok) return jsonResponse(req, { error: result.error }, 401);
  const invite = result.invite;

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
      role: invite.role,
      cpf: nullIfEmpty(body.cpf)?.replace(/\D/g, "") || null,
      cpf_last4: nullIfEmpty(body.cpf)?.replace(/\D/g, "").slice(-4) || null,
      email: nullIfEmpty(body.email)?.toLowerCase() ?? null,
      phone: nullIfEmpty(body.phone)?.replace(/\D/g, "") || null,
      birth_date: body.birthDate || null,
      admission_date: invite.admission_date,
      position: invite.position,
      contract_type: "CLT",
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

  if (invite.unit_ids.length > 0) {
    await adminClient
      .from("fa_kiosk_employee_units")
      .insert(invite.unit_ids.map((unitId) => ({ employee_id: employeeRow.id, unit_id: unitId })));
  }

  const pi = body.personalInfo ?? {};
  await adminClient.from("fa_kiosk_employee_personal_info").insert({
    employee_id: employeeRow.id,
    ctps_numero: nullIfEmpty(pi.ctpsNumero),
    ctps_serie: nullIfEmpty(pi.ctpsSerie),
    ctps_uf: nullIfEmpty(pi.ctpsUf),
    rg_numero: nullIfEmpty(pi.rgNumero),
    rg_orgao_emissor: nullIfEmpty(pi.rgOrgaoEmissor),
    nome_mae: nullIfEmpty(pi.nomeMae),
    nome_pai: nullIfEmpty(pi.nomePai),
    estado_civil: nullIfEmpty(pi.estadoCivil),
    escolaridade: nullIfEmpty(pi.escolaridade),
    raca_cor: nullIfEmpty(pi.racaCor),
    cep: nullIfEmpty(pi.cep),
    logradouro: nullIfEmpty(pi.logradouro),
    numero: nullIfEmpty(pi.numero),
    complemento: nullIfEmpty(pi.complemento),
    bairro: nullIfEmpty(pi.bairro),
    cidade: nullIfEmpty(pi.cidade),
    uf: nullIfEmpty(pi.uf),
    emergency_contact_name: nullIfEmpty(pi.emergencyContactName),
    emergency_contact_phone: nullIfEmpty(pi.emergencyContactPhone),
    completed_at_ms: Date.now(),
  });

  if (nullIfEmpty(body.pixKey)) {
    await adminClient.from("fa_kiosk_employee_payroll_info").insert({
      employee_id: employeeRow.id,
      pix_key: nullIfEmpty(body.pixKey),
    });
  }

  await adminClient
    .from("fa_kiosk_onboarding_invites")
    .update({ used_at_ms: Date.now(), used_by_employee_id: employeeRow.id })
    .eq("id", invite.id);

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_EMPLOYEE_ONBOARDING_INVITE_COMPLETE",
    severity: "ALERTA",
    details_json: { employeeId: employeeRow.id, inviteId: invite.id, role: invite.role },
  });

  return jsonResponse(req, { id: employeeRow.id });
});
