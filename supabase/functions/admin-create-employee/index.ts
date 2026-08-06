// Cria um colaborador com login real (auth.users + fa_kiosk_employees).
// Só pode rodar aqui porque `auth.admin.createUser` exige a service role —
// nunca disponível no cliente (anon key nem sessão de usuário bastam).
// Confere que quem chama já é ADMIN autenticado antes de criar qualquer
// coisa, usando o JWT repassado automaticamente pelo `supabase.functions.invoke`.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CONTRACT_TYPES = ["CLT", "ESTAGIO", "AUTONOMO"];
const ROLES = ["OPERADOR", "GERENTE", "ADMIN"];

interface CreateEmployeeBody {
  fullName: string;
  role: string;
  cpf: string;
  email: string;
  birthDate: string;
  admissionDate: string;
  position: string;
  contractType: string;
  weeklyHoursContracted: number;
}

function randomTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 14) + "aA1!";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
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

  if (!body.fullName || !body.email || !body.cpf || !body.birthDate || !body.admissionDate || !body.position) {
    return jsonResponse({ error: "preencha nome, e-mail, CPF, data de nascimento, admissão e cargo" }, 400);
  }
  if (!ROLES.includes(body.role)) return jsonResponse({ error: "papel inválido" }, 400);
  if (!CONTRACT_TYPES.includes(body.contractType)) return jsonResponse({ error: "tipo de contrato inválido" }, 400);

  // Client com service role — só a partir daqui, e só depois de confirmar
  // que o chamador é ADMIN, é que se toca auth.users/fa_kiosk_employees
  // ignorando RLS.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const temporaryPassword = randomTemporaryPassword();
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email: body.email,
    password: temporaryPassword,
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
      email: body.email,
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
    // órfã (fullLogin/quickSwitch rejeitam "conta sem funcionário
    // vinculado"), então desfaz para não deixar lixo em auth.users.
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    return jsonResponse({ error: insertError?.message ?? "não foi possível salvar o colaborador" }, 400);
  }

  return jsonResponse({ id: employeeRow.id, temporaryPassword });
});
