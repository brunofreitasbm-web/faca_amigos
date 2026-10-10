import { useCallback, useEffect, useState } from "react";
import { Api, type PendingSessionReport, type RecentSessionReport } from "./client.js";

const POLL_MS = 60_000;

/**
 * Olhares preenchidos até 07/10/2026 (horário de Belém, UTC-3, inclusive) saem da tela do operador:
 * as falhas antigas de entrega (63049) não são mais acionáveis e faziam o selo da navegação piscar.
 * O registro continua no banco e no Gerencial. 08/10/2026 00:00 em Belém = 03:00 UTC.
 */
export const OLHAR_HIDDEN_BEFORE_MS = Date.UTC(2026, 9, 8, 3, 0, 0);

/** A Meta recusou ESTA mensagem (63049): reenviar o mesmo modelo falha de novo, então o botão Reenviar não aparece. */
export const isWhatsappRefusal63049 = (error: string | null | undefined): boolean => !!error && error.includes("63049");

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
 * Relatórios preenchidos que ainda não chegaram ao responsável (Twilio recusou,
 * sem modelo/canal, ou envio parado), de qualquer dia: ficam aqui até serem
 * enviados — automático ou manual. Alimenta o badge piscante da navegação e o
 * banner da tela do Olhar; antes só contava os de "hoje", então a pendência
 * sumia à meia-noite.
 */
export function useUnsentSessionReports(unitId: string | null) {
  const [unsent, setUnsent] = useState<RecentSessionReport[]>([]);

  const refetch = useCallback(async () => {
    if (!unitId) return;
    try {
      const rows = await Api.sessionReportsUnsent(unitId);
      setUnsent(rows.filter((r) => r.filled_at_ms >= OLHAR_HIDDEN_BEFORE_MS));
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

  return { unsent, unsentCount: unsent.length, refetch };
}
