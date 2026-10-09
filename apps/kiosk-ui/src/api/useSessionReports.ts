import { useCallback, useEffect, useState } from "react";
import { Api, type PendingSessionReport } from "./client.js";

const POLL_MS = 60_000;

/** Meia-noite local de hoje, em ms — mesma janela usada em "Enviados hoje". */
export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Fila do Olhar FaçaAmigos pendente da unidade. Atualiza a cada minuto e
 * quando a aba volta a ficar visível. Falha de rede mantém o último valor:
 * um badge que some por um soluço de conexão faria o prazo de 40 min passar.
 */
export function usePendingSessionReports(unitId: string | null) {
  const [pending, setPending] = useState<PendingSessionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!unitId) return;
    try {
      setPending(await Api.sessionReportsPending(unitId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar relatórios pendentes");
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => {
    setLoading(true);
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  const overdueCount = pending.filter((p) => p.deadline_ms < Date.now()).length;
  return { pending, overdueCount, loading, error, refetch };
}

/**
 * Quantos relatórios de hoje ficaram com `FAILED` (Twilio recusou o envio
 * automático). Alimenta o badge piscante do Olhar FaçaAmigos na navegação —
 * sem isso, uma recusa só aparecia pra quem já estivesse na tela certa.
 */
export function useFailedSessionReportsCount(unitId: string | null) {
  const [failedCount, setFailedCount] = useState(0);

  const refetch = useCallback(async () => {
    if (!unitId) return;
    try {
      const recent = await Api.sessionReportsRecent(unitId, startOfTodayMs());
      setFailedCount(recent.filter((r) => r.whatsapp_status === "FAILED").length);
    } catch {
      /* mantém o último valor: um soluço de rede não deve apagar o alerta */
    }
  }, [unitId]);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  return { failedCount, refetch };
}
