import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthStore } from "./oauthFlow.js";

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`oauth store: ${what}`);
}

export function createOAuthStore(supabase: SupabaseClient): OAuthStore {
  return {
    async countClients() {
      const { count, error } = await supabase.from("fa_mcp_oauth_clients").select("client_id", { count: "exact", head: true });
      check(error, "countClients");
      return count ?? 0;
    },
    async insertClient(c) {
      check((await supabase.from("fa_mcp_oauth_clients").insert(c)).error, "insertClient");
    },
    async getClient(id) {
      const { data, error } = await supabase
        .from("fa_mcp_oauth_clients")
        .select("client_id, client_name, redirect_uris")
        .eq("client_id", id)
        .maybeSingle();
      check(error, "getClient");
      return data ?? null;
    },
    async insertCode(c) {
      // Aproveita para limpar códigos vencidos.
      await supabase.from("fa_mcp_oauth_codes").delete().lt("expires_at", new Date().toISOString());
      check((await supabase.from("fa_mcp_oauth_codes").insert(c)).error, "insertCode");
    },
    async takeCode(codeHash) {
      const { data, error } = await supabase
        .from("fa_mcp_oauth_codes")
        .delete()
        .eq("code_hash", codeHash)
        .select("client_id, redirect_uri, code_challenge, expires_at")
        .maybeSingle();
      check(error, "takeCode");
      return data ?? null;
    },
    async insertToken(t) {
      check((await supabase.from("fa_mcp_oauth_tokens").insert(t)).error, "insertToken");
    },
    async rotateToken(oldRefreshHash, clientId, next, nowIso) {
      const { data, error } = await supabase
        .from("fa_mcp_oauth_tokens")
        .update({
          access_hash: next.access_hash,
          refresh_hash: next.refresh_hash,
          access_expires_at: next.access_expires_at,
          refresh_expires_at: next.refresh_expires_at,
        })
        .eq("refresh_hash", oldRefreshHash)
        .eq("client_id", clientId)
        .is("revoked_at", null)
        .gt("refresh_expires_at", nowIso)
        .select("id")
        .maybeSingle();
      check(error, "rotateToken");
      return !!data;
    },
    async getConfig() {
      const { data, error } = await supabase
        .from("fa_mcp_oauth_config")
        .select("password_hash, failed_count, locked_until")
        .eq("id", 1)
        .maybeSingle();
      check(error, "getConfig");
      return data ?? null;
    },
    async setAttempts(failedCount, lockedUntil) {
      check(
        (await supabase.from("fa_mcp_oauth_config").update({ failed_count: failedCount, locked_until: lockedUntil }).eq("id", 1)).error,
        "setAttempts",
      );
    },
  };
}
