// Redefine o PIN de um colaborador já existente (ex.: esqueceu o PIN).
// A autorização não é mais "o papel do chamador é ADMIN" checado aqui, e
// sim `fa_kiosk_can('config.employees.write')` — a mesma função que as
// policies de RLS usam, para não existir uma segunda implementação da
// regra divergindo desta. Ver supabase/functions/_shared/requireCapability.ts.

import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

const PIN_PATTERN = /^\d{6}$/;

interface SetPinBody {
  employeeId: string;
  pin: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.employees.write");
  if (!auth.ok) return auth.response;

  let body: SetPinBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!body.employeeId) return jsonResponse(req, { error: "colaborador inválido" }, 400);
  if (!PIN_PATTERN.test(body.pin ?? "")) {
    return jsonResponse(req, { error: "o PIN precisa ter exatamente 6 dígitos" }, 400);
  }

  // Service role só depois do guard ter passado.
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: upsertError } = await adminClient
    .from("fa_kiosk_local_credentials")
    .upsert({ employee_id: body.employeeId, pin_hash: bcrypt.hashSync(body.pin, 10) }, { onConflict: "employee_id" });
  if (upsertError) return jsonResponse(req, { error: "não foi possível salvar o PIN" }, 400);

  // Redefinir o PIN destrava: caso contrário o colaborador que foi alvo de
  // uma varredura continua bloqueado mesmo com PIN novo.
  await adminClient.from("fa_kiosk_pin_attempts").delete().eq("employee_id", body.employeeId);

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_EMPLOYEE_PIN_RESET",
    severity: "ALERTA",
    details_json: { employeeId: body.employeeId, byAuthUserId: auth.userId },
  });

  return jsonResponse(req, { ok: true });
});
