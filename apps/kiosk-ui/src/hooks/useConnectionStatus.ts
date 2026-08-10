import { useEffect, useState } from "react";
import { pendingCount, OFFLINE_FLUSH_EVENT } from "../lib/supabase/offlineQueue.js";

export type ConnectionStatus = "online" | "degraded" | "offline";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Operações na fila offline aguardando reenvio. */
  pending: number;
}

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

/**
 * Estado de conexão do dispositivo com a nuvem (Supabase):
 * - `offline`  → sem rede nenhuma (navigator.onLine false);
 * - `degraded` → Wi-Fi conectado mas a nuvem não responde (internet caída
 *   no roteador, por exemplo) ou há operações presas na fila offline;
 * - `online`   → nuvem alcançável.
 * O ping usa o endpoint público de health do Supabase Auth — barato e sem
 * autenticação — a cada 30s, ao reconectar e ao voltar para a aba.
 */
export function useConnectionStatus(): ConnectionState {
  const [status, setStatus] = useState<ConnectionStatus>(navigator.onLine ? "online" : "offline");
  const [pending, setPending] = useState(pendingCount());

  useEffect(() => {
    let cancelled = false;

    async function ping() {
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!base) {
        setStatus("online");
        return;
      }
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
        const headers: Record<string, string> = {};
        if (key) {
          headers["apikey"] = key;
        }
        const res = await fetch(`${base}/auth/v1/health`, {
          cache: "no-store",
          signal: ctrl.signal,
          headers,
        });
        clearTimeout(timeout);
        if (!cancelled) setStatus(res.ok ? "online" : "degraded");
      } catch {
        if (!cancelled) setStatus("degraded");
      }
    }

    const refreshPending = () => setPending(pendingCount());
    const onOnline = () => {
      setStatus("online");
      void ping();
    };
    const onOffline = () => setStatus("offline");
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_FLUSH_EVENT, refreshPending);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      void ping();
      refreshPending();
    }, PING_INTERVAL_MS);
    void ping();

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_FLUSH_EVENT, refreshPending);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { status, pending };
}
