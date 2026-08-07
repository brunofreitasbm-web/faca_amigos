// Cria um colaborador com login por PIN (auth.users + fa_kiosk_employees +
// fa_kiosk_local_credentials). Só pode rodar aqui porque `auth.admin.
// createUser` exige a service role — nunca disponível no cliente (anon
// key nem sessão de usuário bastam).
//
// A autorização é `fa_kiosk_can('config.employees.write')`, a mesma função
// usada pelas policies de RLS e pelas RPCs de configuração — ver
// supabase/functions/_shared/requireCapability.ts para o porquê de não
// checar o papel aqui na mão.
//
// Não existe e-mail/senha visível em lugar nenhum deste fluxo: o
// colaborador escolhe/recebe um PIN, ponto. A conta em auth.users criada
// abaixo usa um e-mail SINTÉTICO (nunca mostrado, nunca digitado por
// ninguém) só porque o GoTrue exige um identificador — quem autentica de
// verdade é o PIN, verificado em login-pin.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

const CONTRACT_TYPES = ["CLT", "ESTAGIO", "AUTONOMO"];
const ROLES = ["OPERADOR", "GERENTE", "ADMIN"];
const PIN_PATTERN = /^\d{6}$/;
const CPF_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d{10,11}$/;

interface CreateEmployeeBody {
  fullName: string;
  role: string;
  cpf: string;
  email: string;
  phone: string;
  pin: string;
  birthDate: string;
  admissionDate: string;
  position: string;
  contractType: string;
  weeklyHoursContracted: number;
}

function randomInternalPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.employees.write");
  if (!auth.ok) return auth.response;

  let body: CreateEmployeeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  if (!body.fullName || !body.cpf || !body.email || !body.phone || !body.birthDate || !body.admissionDate || !body.position) {
    return jsonResponse(req, { error: "preencha nome, CPF, e-mail, telefone, data de nascimento, admissão e cargo" }, 400);
  }
  if (!CPF_PATTERN.test(body.cpf.replace(/\D/g, ""))) {
    return jsonResponse(req, { error: "CPF precisa ter 11 dígitos" }, 400);
  }
  if (!EMAIL_PATTERN.test(body.email.trim())) {
    return jsonResponse(req, { error: "e-mail inválido" }, 400);
  }
  if (!PHONE_PATTERN.test(body.phone.replace(/\D/g, ""))) {
    return jsonResponse(req, { error: "telefone precisa ter 10 ou 11 dígitos (com DDD)" }, 400);
  }
  if (!ROLES.includes(body.role)) return jsonResponse(req, { error: "papel inválido" }, 400);
  if (!CONTRACT_TYPES.includes(body.contractType)) {
    return jsonResponse(req, { error: "tipo de contrato inválido" }, 400);
  }
  if (!PIN_PATTERN.test(body.pin ?? "")) {
    return jsonResponse(req, { error: "o PIN precisa ter exatamente 6 dígitos" }, 400);
  }

  // Client com service role — só a partir daqui, e só depois do guard.
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
      full_name: body.fullName,
      role: body.role,
      cpf: body.cpf.replace(/\D/g, ""),
      cpf_last4: body.cpf.replace(/\D/g, "").slice(-4),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.replace(/\D/g, ""),
      birth_date: body.birthDate,
      admission_date: body.admissionDate,
      position: body.position,
      contract_type: body.contractType,
      weekly_hours_contracted: body.weeklyHoursContracted,
    })
    .select("id")
    .single();

  if (insertError || !employeeRow) {
    // A conta de login já foi criada — sem o employee vinculado ela fica
    // órfã, então desfaz para não deixar lixo em auth.users.
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

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_EMPLOYEE_CREATE",
    severity: "ALERTA",
    details_json: { employeeId: employeeRow.id, role: body.role, byAuthUserId: auth.userId },
  });

  return jsonResponse(req, { id: employeeRow.id });
});
