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

  // Token OAuth (fa_oat_...): vale para todas as unidades, pois quem autoriza é o dono.
  if (token.startsWith("fa_oat_")) {
    const { data: t, error: tErr } = await supabase
      .from("fa_mcp_oauth_tokens")
      .select("id, access_expires_at, revoked_at")
      .eq("access_hash", keyHash)
      .maybeSingle();
    if (tErr || !t) return { ok: false, status: 401, error: "CHAVE_INVALIDA" };
    if (t.revoked_at) return { ok: false, status: 401, error: "CHAVE_REVOGADA" };
    if (new Date(t.access_expires_at) <= new Date()) return { ok: false, status: 401, error: "TOKEN_EXPIRADO" };
    return { ok: true, scope: { keyId: t.id, unitIds: null } };
  }

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
