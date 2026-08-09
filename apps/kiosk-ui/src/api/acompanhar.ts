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
  return acompanharSessaoSchema.parse(data);
}

export async function logAcompanharEvento(
  code: string,
  kind: AcompanharEventoKind,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase().rpc("fa_acompanhar_evento", { p_code: code, p_kind: kind, p_payload: payload });
  if (error) throw new Error(error.message);
}
