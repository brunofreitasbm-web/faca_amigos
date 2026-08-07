import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase/client.js";
import { fetchActiveSessionsRaw, computeActiveSessionEntries } from "./client.js";
import type { ActiveSessionEntry, ActiveSessionsRaw } from "./client.js";

export type ActiveSessionsStatus = "loading" | "ready" | "error";

export interface ActiveSessionsResult {
  entries: ActiveSessionEntry[];
  /**
   * "loading" só é verdade na primeira busca de uma unidade. Existe
   * porque `entries` começa como `[]` e o Painel usava esse `[]` pra
   * decidir "nenhuma criança em atividade" — um estado vazio confiante e
   * ERRADO toda vez que a tela abria, na tela que controla quem paga.
   */
  status: ActiveSessionsStatus;
  /** Mensagem da última falha de busca, se `status === "error"`. */
  errorMessage: string | null;
}

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
export function useActiveSessions(unitId: string | null): ActiveSessionsResult {
  const [raw, setRaw] = useState<ActiveSessionsRaw>({
    sessions: [],
    planById: new Map(),
    guardianById: new Map(),
    assetById: new Map(),
    childById: new Map(),
    packageBalanceByGuardian: new Map(),
  });
  const [entries, setEntries] = useState<ActiveSessionEntry[]>([]);
  const [status, setStatus] = useState<ActiveSessionsStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    loadedOnce.current = false;
    setStatus("loading");

    async function refetch() {
      try {
        const data = await fetchActiveSessionsRaw(unitId!);
        if (cancelled) return;
        setRaw(data);
        setStatus("ready");
        setErrorMessage(null);
        loadedOnce.current = true;
      } catch (err) {
        if (cancelled) return;
        // Numa falha depois de já ter carregado uma vez (ex: reconsulta
        // disparada pelo Realtime), mantém o último dado bom na tela em
        // vez de trocar por um estado vazio — só a mensagem de erro
        // aparece, pra não fingir que a lista esvaziou sozinha.
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Não foi possível atualizar o painel.");
      }
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

  return { entries, status, errorMessage };
}
