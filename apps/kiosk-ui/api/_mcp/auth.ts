import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export interface McpScope {
  keyId: string;
  /** null = todas as unidades. */
  unitIds: string[] | null;
}

export type McpAuthResult = { ok: true; scope: McpScope } | { ok: false; status: number; error: string };

export function extractToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers["authorization"];
  const apiKeyHeader = headers["x-api-key"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  if (typeof apiKeyHeader === "string") return apiKeyHeader.trim() || null;
  return null;
}

export async function authenticateMcpRequest(
  supabase: SupabaseClient,
  headers: Record<string, string | string[] | undefined>,
): Promise<McpAuthResult> {
  const token = extractToken(headers);
  if (!token) return { ok: false, status: 401, error: "CHAVE_AUSENTE" };

  const keyHash = createHash("sha256").update(token).digest("hex");
  const { data: keyRow, error } = await supabase
    .from("fa_mcp_api_keys")
    .select("id, unit_ids, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !keyRow) return { ok: false, status: 401, error: "CHAVE_INVALIDA" };
  if (keyRow.revoked_at) return { ok: false, status: 401, error: "CHAVE_REVOGADA" };

  void supabase.from("fa_mcp_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

  return { ok: true, scope: { keyId: keyRow.id, unitIds: (keyRow.unit_ids as string[] | null) ?? null } };
}
