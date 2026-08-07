import type { SupabaseClient } from "@supabase/supabase-js";
import { hasCscConfigured, readCertificadoMetaFromVault, type CofreCrypto } from "./vault.js";

/**
 * Heartbeat do terminal emissor (M3 do plano — "o que transforma risco
 * silencioso em problema visível"). Sem isto, o certificado vence ou o PC
 * morre e ninguém percebe por semanas. Grava só metadados não secretos:
 * CN, CNPJ e validade lidos do próprio `.pfx` — nunca a senha, nunca o CSC.
 *
 * Uma linha por UNIDADE com `fiscal_enabled = true`, porque o mesmo PC do
 * balcão pode servir mais de uma unidade (LOJA + QUIOSQUE) e
 * `fa_kiosk_fiscal_terminal_status` tem `unit_id` como chave primária. Se
 * nenhuma unidade tiver o fiscal ligado ainda, não grava nada — coerente
 * com `fiscal_enabled = false` por padrão não emitir nada.
 */

export interface HeartbeatDeps {
  supabase: SupabaseClient;
  terminalId: string;
  userDataPath: string;
  crypto: CofreCrypto;
  workerVersion: string;
  onLog?: (message: string) => void;
}

export async function sendFiscalHeartbeat(deps: HeartbeatDeps): Promise<void> {
  const { data: units, error } = await deps.supabase
    .from("fa_kiosk_units")
    .select("id, fiscal_ambiente")
    .eq("fiscal_enabled", true);

  if (error) {
    deps.onLog?.(`[fiscal] heartbeat: não foi possível listar unidades: ${error.message}`);
    return;
  }
  if (!units || units.length === 0) return;

  let certMeta: ReturnType<typeof readCertificadoMetaFromVault> | undefined;
  let certError: string | null = null;
  try {
    certMeta = readCertificadoMetaFromVault({ userDataPath: deps.userDataPath, crypto: deps.crypto });
  } catch (err) {
    certError = err instanceof Error ? err.message : String(err);
  }

  const nowMs = Date.now();
  const rows = (units as Array<{ id: string; fiscal_ambiente: string }>).map((unit) => ({
    unit_id: unit.id,
    terminal_id: deps.terminalId,
    worker_version: deps.workerVersion,
    cert_subject_cn: certMeta?.subjectCn ?? null,
    cert_cnpj: certMeta?.cnpj ?? null,
    cert_not_after_ms: certMeta?.notAfterMs ?? null,
    csc_configured: hasCscConfigured(deps.userDataPath),
    environment: unit.fiscal_ambiente,
    last_heartbeat_ms: nowMs,
    last_error: certError,
  }));

  const { error: upsertError } = await deps.supabase
    .from("fa_kiosk_fiscal_terminal_status")
    .upsert(rows, { onConflict: "unit_id" });
  if (upsertError) {
    deps.onLog?.(`[fiscal] heartbeat: upsert falhou: ${upsertError.message}`);
  }
}

/** Dispara o heartbeat imediatamente e depois a cada `intervalMs` (padrão 60s). Retorna uma função para parar. */
export function startFiscalHeartbeatLoop(deps: HeartbeatDeps, intervalMs = 60_000): () => void {
  void sendFiscalHeartbeat(deps);
  const timer = setInterval(() => void sendFiscalHeartbeat(deps), intervalMs);
  return () => clearInterval(timer);
}
