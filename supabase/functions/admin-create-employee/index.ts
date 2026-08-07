// Cria um colaborador com login por PIN (auth.users + fa_kiosk_employees +
// fa_kiosk_local_credentials). Só pode rodar aqui porque `auth.admin.
// createUser` exige a service role — nunca disponível no cliente (anon
// key nem sessão de usuário bastam). Confere que quem chama já é ADMIN
// autenticado antes de criar qualquer coisa, usando o JWT repassado
// automaticamente pelo `supabase.functions.invoke`.
//
// Não existe e-mail/senha visível em lugar nenhum deste fluxo: o
// colaborador escolhe/recebe um PIN, ponto. A conta em auth.users criada
// abaixo usa um e-mail SINTÉTICO (nunca mostrado, nunca digitado por
// ninguém) só porque o GoTrue exige um identificador — quem autentica de
// verdade é o PIN, verificado em login-pin.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const CONTRACT_TYPES = ["CLT", "ESTAGIO", "AUTONOMO"];
const ROLES = ["OPERADOR", "GERENTE", "ADMIN"];
const PIN_PATTERN = /^\d{6}$/;

interface CreateEmployeeBody {
  fullName: string;
  role: string;
  cpf: string;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "não autenticado" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Client "como o chamador" — só serve para confirmar que a sessão é
  // válida e que o colaborador vinculado a ela é ADMIN.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "não autenticado" }, 401);

  const { data: callerEmployee, error: callerError } = await callerClient
    .from("fa_kiosk_employees")
    .select("id, role, active")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (callerError || !callerEmployee || !callerEmployee.active || callerEmployee.role !== "ADMIN") {
    return jsonResponse({ error: "só um ADMIN pode cadastrar colaborador" }, 403);
  }

  let body: CreateEmployeeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "corpo inválido" }, 400);
  }

  if (!body.fullName || !body.cpf || !body.birthDate || !body.admissionDate || !body.position) {
    return jsonResponse({ error: "preencha nome, CPF, data de nascimento, admissão e cargo" }, 400);
  }
  if (!ROLES.includes(body.role)) return jsonResponse({ error: "papel inválido" }, 400);
  if (!CONTRACT_TYPES.includes(body.contractType)) return jsonResponse({ error: "tipo de contrato inválido" }, 400);
  if (!PIN_PATTERN.test(body.pin ?? "")) return jsonResponse({ error: "o PIN precisa ter exatamente 6 dígitos" }, 400);

  // Client com service role — só a partir daqui, e só depois de confirmar
  // que o chamador é ADMIN, é que se toca auth.users/fa_kiosk_employees
  // ignorando RLS.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const syntheticEmail = `employee-${crypto.randomUUID()}@kiosk.internal`;
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email: syntheticEmail,
    password: randomInternalPassword(),
    email_confirm: true,
  });
  if (createUserError || !createdUser.user) {
    return jsonResponse({ error: createUserError?.message ?? "não foi possível criar a conta de login" }, 400);
  }

  const { data: employeeRow, error: insertError } = await adminClient
    .from("fa_kiosk_employees")
    .insert({
      auth_user_id: createdUser.user.id,
      full_name: body.fullName,
      role: body.role,
      cpf: body.cpf,
      cpf_last4: body.cpf.replace(/\D/g, "").slice(-4),
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
    return jsonResponse({ error: insertError?.message ?? "não foi possível salvar o colaborador" }, 400);
  }

  const { error: credentialsError } = await adminClient.from("fa_kiosk_local_credentials").insert({
    employee_id: employeeRow.id,
    pin_hash: bcrypt.hashSync(body.pin, 10),
  });
  if (credentialsError) {
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    await adminClient.from("fa_kiosk_employees").delete().eq("id", employeeRow.id);
    return jsonResponse({ error: "não foi possível salvar o PIN" }, 400);
  }

  return jsonResponse({ id: employeeRow.id });
});
