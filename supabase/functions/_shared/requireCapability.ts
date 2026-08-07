// Guard de autorização das Edge Functions.
//
// Substitui o `callerEmployee.role !== "ADMIN"` que estava copiado em cada
// função. A diferença não é estética: a decisão passa a ser tomada por
// `fa_kiosk_can` no banco — a MESMA função que as policies de RLS e as RPCs
// de configuração usam. Não existe segunda implementação da regra para
// divergir quando um papel novo ou uma capacidade nova aparecer.
//
// A checagem roda com um client "como o chamador" (anon key + o header
// Authorization repassado pelo supabase.functions.invoke), nunca com a
// service role: assim `auth.uid()` dentro de fa_kiosk_can é o do
// colaborador de verdade. A service role só entra depois, e só se este
// guard tiver passado.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./http.ts";

export interface CapabilityOk {
  ok: true;
  userId: string;
  /** Client já autenticado como o chamador — reaproveitável para leituras. */
  callerClient: SupabaseClient;
}

export interface CapabilityDenied {
  ok: false;
  response: Response;
}

export async function requireCapability(
  req: Request,
  capability: string,
): Promise<CapabilityOk | CapabilityDenied> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: jsonResponse(req, { error: "não autenticado" }, 401) };
  }

  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, response: jsonResponse(req, { error: "não autenticado" }, 401) };
  }

  const { data: allowed, error: rpcError } = await callerClient.rpc("fa_kiosk_can", {
    p_capability: capability,
  });
  // `allowed !== true` e não `!allowed`: se a RPC falhar, `allowed` vem
  // null/undefined e a resposta tem que ser negar, nunca permitir.
  if (rpcError || allowed !== true) {
    return { ok: false, response: jsonResponse(req, { error: "sem permissão" }, 403) };
  }

  return { ok: true, userId: userData.user.id, callerClient };
}
