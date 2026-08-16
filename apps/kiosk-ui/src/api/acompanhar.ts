import { acompanharSessaoSchema } from "@facaamigos/contracts";
import type { AcompanharSessao, AcompanharEventoKind } from "@facaamigos/contracts";
import { supabase } from "../lib/supabase/client.js";

/**
 * Chamadas da tela pública `?acompanhar=<code>` (painel do responsável).
 * Usa a chave anon — não passa por login — e as RPCs `fa_acompanhar_*`,
 * que são a única porta de leitura/escrita liberada para `anon` desde o
 * endurecimento de segurança (ver supabase/migrations/20260809000001).
 */
export async function fetchAcompanharSessao(code: string): Promise<AcompanharSessao> {
  const { data, error } = await supabase().rpc("fa_acompanhar_por_codigo", { p_code: code });
  if (error) throw new Error(error.message);
  try {
    return acompanharSessaoSchema.parse(data);
  } catch (err) {
    console.error("[useAcompanhar] Falha de validação Zod nos dados recebidos:", err, data);
    throw new Error("Não foi possível carregar os dados de acompanhamento da sessão.");
  }
}

export async function logAcompanharEvento(
  code: string,
  kind: AcompanharEventoKind,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase().rpc("fa_acompanhar_evento", { p_code: code, p_kind: kind, p_payload: payload });
  if (error) throw new Error(error.message);
}

/** Inscreve o navegador do responsável para o alerta em segundo plano (Web Push) — ver src/lib/push.ts. */
export async function registrarAcompanharPush(
  code: string,
  keys: { endpoint: string; p256dh: string; auth: string },
): Promise<{ alertDueAtMs: number }> {
  const { data, error } = await supabase().rpc("fa_acompanhar_registrar_push", {
    p_code: code,
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  });
  if (error) throw new Error(error.message);
  return { alertDueAtMs: Number((data as { alertDueAtMs: number }).alertDueAtMs) };
}
