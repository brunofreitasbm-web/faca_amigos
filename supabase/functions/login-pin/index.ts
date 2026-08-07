// Login por PIN — a ÚNICA forma de autenticação de colaborador no
// terminal. Não existe e-mail/senha em lugar nenhum da UI: cada
// colaborador tem uma conta em auth.users com um e-mail SINTÉTICO
// (gerado em admin-create-employee, nunca mostrado nem digitado por
// ninguém) só para satisfazer o requisito do GoTrue de precisar de um
// identificador. O PIN é conferido aqui, no servidor, contra o hash em
// fa_kiosk_local_credentials — e só se bater é que uma sessão real é
// emitida, via `admin.generateLink` (magic link nunca enviado por
// e-mail; o token volta direto na resposta HTTP e o cliente troca por
// sessão com `auth.verifyOtp`). Isso preserva `auth.uid()` correto para
// RLS/audit_log em todo o app, sem nenhum passo de e-mail/senha.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

interface LoginPinBody {
  employeeId: string;
  pin: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Mensagem genérica em qualquer falha (colaborador inexistente, inativo,
// sem PIN cadastrado ou PIN errado) — não dá pra um terminal descobrir
// por tentativa e erro se um employeeId existe ou está ativo.
const GENERIC_ERROR = "PIN incorreto";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: LoginPinBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "corpo inválido" }, 400);
  }
  if (!body.employeeId || !body.pin) return jsonResponse({ error: GENERIC_ERROR }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: employee, error: employeeError } = await adminClient
    .from("fa_kiosk_employees")
    .select("id, full_name, role, active, auth_user_id")
    .eq("id", body.employeeId)
    .single();
  if (employeeError || !employee || !employee.active || !employee.auth_user_id) {
    return jsonResponse({ error: GENERIC_ERROR }, 401);
  }

  const { data: credentials, error: credentialsError } = await adminClient
    .from("fa_kiosk_local_credentials")
    .select("pin_hash")
    .eq("employee_id", employee.id)
    .single();
  if (credentialsError || !credentials) return jsonResponse({ error: GENERIC_ERROR }, 401);

  const pinOk = bcrypt.compareSync(body.pin, credentials.pin_hash);
  if (!pinOk) return jsonResponse({ error: GENERIC_ERROR }, 401);

  const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(employee.auth_user_id);
  if (authUserError || !authUser.user?.email) return jsonResponse({ error: GENERIC_ERROR }, 401);

  const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    return jsonResponse({ error: "não foi possível iniciar a sessão" }, 500);
  }

  return jsonResponse({
    tokenHash: link.properties.hashed_token,
    employee: { id: employee.id, full_name: employee.full_name, role: employee.role },
  });
});
