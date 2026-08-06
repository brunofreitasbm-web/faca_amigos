import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase/client.js";
import { fetchActiveSessionsRaw, computeActiveSessionEntries } from "./client.js";
import type { ActiveSessionEntry, ActiveSessionsRaw } from "./client.js";

/**
 * Fase 3: substitui o antigo canal WS de 1Hz (apps/kiosk/src/server/ws-tick.ts,
 * que reconsultava o SQLite local a cada segundo). Agora:
 * 1) os dados crus só são buscados quando algo muda de verdade (Supabase
 *    Realtime em fa_kiosk_sessions, ou uma vez no início);
 * 2) o valor/tempo exibido é recalculado localmente a cada segundo com
 *    `computeSessionTiming`/`quoteForSession` (packages/domain, puro),
 *    sem round-trip de rede — mais responsivo que o 1Hz antigo, porque
 *    uma troca de plano/checkout aparece na hora, via Realtime, em vez de
 *    esperar o próximo tick do servidor.
 */
export function useActiveSessions(unitId: string | null): ActiveSessionEntry[] {
  const [raw, setRaw] = useState<ActiveSessionsRaw>({
    sessions: [],
    planById: new Map(),
    guardianById: new Map(),
    assetById: new Map(),
    childById: new Map(),
  });
  const [entries, setEntries] = useState<ActiveSessionEntry[]>([]);
  const rawRef = useRef(raw);
  rawRef.current = raw;

  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;

    async function refetch() {
      const data = await fetchActiveSessionsRaw(unitId!);
      if (!cancelled) setRaw(data);
    }
    refetch();

    const channel = supabase()
      .channel(`fa_kiosk_sessions:unit:${unitId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "fa_kiosk_sessions", filter: `unit_id=eq.${unitId}` }, refetch)
      .subscribe();

    return () => {
      cancelled = true;
      supabase().removeChannel(channel);
    };
  }, [unitId]);

  useEffect(() => {
    setEntries(computeActiveSessionEntries(raw, Date.now()));
    const interval = setInterval(() => setEntries(computeActiveSessionEntries(rawRef.current, Date.now())), 1000);
    return () => clearInterval(interval);
  }, [raw]);

  return entries;
}
