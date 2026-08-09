import { useEffect, useRef, useState } from "react";
import { computeSessionTiming } from "@facaamigos/domain";
import type { SessionTiming, Plan } from "@facaamigos/domain";
import type { AcompanharSessao } from "@facaamigos/contracts";
import { fetchAcompanharSessao } from "./acompanhar.js";

export type AcompanharStatus = "loading" | "ready" | "error";

export interface AcompanharResult {
  status: AcompanharStatus;
  sessao: AcompanharSessao | null;
  timing: SessionTiming | null;
  errorMessage: string | null;
}

// A RPC não passa por Realtime (não há policy de SELECT anônima em
// fa_kiosk_sessions — RLS bloquearia um postgres_changes direto mesmo
// com a RPC liberada). Um poll simples é suficiente: o tick de 1s local
// já dá a sensação de "ao vivo" entre uma busca e outra.
const POLL_INTERVAL_MS = 8000;

function planFromSessao(sessao: AcompanharSessao): Plan | null {
  if (sessao.status !== "ATIVA" && sessao.status !== "PAUSADA") return null;
  return {
    id: sessao.sessionId,
    activity: sessao.activity,
    name: "",
    valueCents: sessao.plan.valueCents,
    durationValue: sessao.plan.durationValue,
    durationUnit: sessao.plan.durationUnit,
    overageCentsPerMinute: sessao.plan.overageCentsPerMinute,
    color: "#2ECFB5",
  };
}

export function useAcompanhar(code: string | null): AcompanharResult {
  const [sessao, setSessao] = useState<AcompanharSessao | null>(null);
  const [timing, setTiming] = useState<SessionTiming | null>(null);
  const [status, setStatus] = useState<AcompanharStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessaoRef = useRef<AcompanharSessao | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setStatus("loading");

    async function refetch() {
      try {
        const data = await fetchAcompanharSessao(code!);
        if (cancelled) return;
        sessaoRef.current = data;
        setSessao(data);
        setStatus("ready");
        setErrorMessage(null);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Não foi possível carregar o acompanhamento.");
      }
    }
    refetch();
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [code]);

  useEffect(() => {
    function recompute() {
      const current = sessaoRef.current;
      const plan = current ? planFromSessao(current) : null;
      if (!current || !plan || (current.status !== "ATIVA" && current.status !== "PAUSADA")) {
        setTiming(null);
        return;
      }
      setTiming(
        computeSessionTiming(
          plan,
          { checkinAtMs: current.checkinAtMs, pausedAtMs: current.pausedAtMs, pausedMsTotal: current.pausedMsTotal },
          Date.now(),
        ),
      );
    }
    recompute();
    const interval = setInterval(recompute, 1000);
    return () => clearInterval(interval);
  }, [sessao]);

  return { status, sessao, timing, errorMessage };
}
