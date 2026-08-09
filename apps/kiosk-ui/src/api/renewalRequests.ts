import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client.js";

/**
 * Pedidos de renovação feitos pelo responsável no painel público
 * (?acompanhar=, ver AcompanharScreen) — gravados como eventos em
 * fa_kiosk_session_events pela RPC anônima fa_acompanhar_evento. `authenticated`
 * já tem SELECT direto nessa tabela (RLS de 20260806000009), então não
 * precisa de RPC nova aqui: só o último evento de cada sessão decide se o
 * pedido ainda está pendente (RENOVACAO_SOLICITADA sem um
 * RENOVACAO_APLICADA/RENOVACAO_DISPENSADA posterior).
 */
export interface PendingRenewal {
  sessionId: string;
  minutes: number;
  requestedAtMs: number;
}

const RENEWAL_KINDS = ["RENOVACAO_SOLICITADA", "RENOVACAO_APLICADA", "RENOVACAO_DISPENSADA"] as const;

export async function fetchPendingRenewals(sessionIds: string[]): Promise<Map<string, PendingRenewal>> {
  if (sessionIds.length === 0) return new Map();
  const { data, error } = await supabase()
    .from("fa_kiosk_session_events")
    .select("session_id, kind, at_ms, payload_json")
    .in("session_id", sessionIds)
    .in("kind", RENEWAL_KINDS)
    .order("at_ms", { ascending: true });
  if (error) throw new Error(error.message);

  const lastBySession = new Map<string, { kind: string; at_ms: number; payload_json: Record<string, unknown> | null }>();
  for (const row of (data ?? []) as Array<{ session_id: string; kind: string; at_ms: number; payload_json: Record<string, unknown> | null }>) {
    lastBySession.set(row.session_id, row);
  }

  const pending = new Map<string, PendingRenewal>();
  for (const [sessionId, last] of lastBySession) {
    if (last.kind !== "RENOVACAO_SOLICITADA") continue;
    const minutes = Number(last.payload_json?.minutes ?? 0);
    pending.set(sessionId, { sessionId, minutes, requestedAtMs: last.at_ms });
  }
  return pending;
}

export async function resolveRenewal(sessionId: string, outcome: "APLICADA" | "DISPENSADA", employeeId: string | null): Promise<void> {
  const { error } = await supabase().rpc("fa_kiosk_log_session_event", {
    p_session_id: sessionId,
    p_kind: `RENOVACAO_${outcome}`,
    p_employee_id: employeeId,
    p_payload: {},
  });
  if (error) throw new Error(error.message);
}

const POLL_INTERVAL_MS = 10_000;

/** Reconsulta em intervalo fixo — os eventos vêm de um responsável fora do app, sem canal Realtime já aberto para isso. */
export function usePendingRenewals(sessionIds: string[]): Map<string, PendingRenewal> {
  const [pending, setPending] = useState<Map<string, PendingRenewal>>(new Map());
  const key = sessionIds.slice().sort().join(",");

  useEffect(() => {
    if (!key) {
      setPending(new Map());
      return;
    }
    let cancelled = false;
    async function refetch() {
      try {
        const data = await fetchPendingRenewals(key.split(","));
        if (!cancelled) setPending(data);
      } catch {
        // Falha aqui não deve derrubar o Painel — o badge só reaparece no
        // próximo poll bem-sucedido.
      }
    }
    refetch();
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [key]);

  return pending;
}
