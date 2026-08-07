// Redefine o PIN de um colaborador já existente (ex.: esqueceu o PIN).
// Mesma checagem de "quem chama precisa ser ADMIN" de admin-create-employee
// — ver comentários lá para o porquê do client "como o chamador" + client
// de service role.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const PIN_PATTERN = /^\d{6}$/;

interface SetPinBody {
  employeeId: string;
  pin: string;
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

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "não autenticado" }, 401);

  const { data: callerEmployee, error: callerError } = await callerClient
    .from("fa_kiosk_employees")
    .select("id, role, active")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (callerError || !callerEmployee || !callerEmployee.active || callerEmployee.role !== "ADMIN") {
    return jsonResponse({ error: "só um ADMIN pode redefinir o PIN de um colaborador" }, 403);
  }

  let body: SetPinBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "corpo inválido" }, 400);
  }
  if (!body.employeeId) return jsonResponse({ error: "colaborador inválido" }, 400);
  if (!PIN_PATTERN.test(body.pin ?? "")) return jsonResponse({ error: "o PIN precisa ter exatamente 6 dígitos" }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { error: upsertError } = await adminClient
    .from("fa_kiosk_local_credentials")
    .upsert({ employee_id: body.employeeId, pin_hash: bcrypt.hashSync(body.pin, 10) }, { onConflict: "employee_id" });
  if (upsertError) return jsonResponse({ error: "não foi possível salvar o PIN" }, 400);

  return jsonResponse({ ok: true });
});
