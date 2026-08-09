import type { Plan, SessionForQuote, SessionTiming } from "../pricing/types.js";

export function planDurationMinutes(plan: Plan): number {
  return plan.durationUnit === "HORA" ? plan.durationValue * 60 : plan.durationValue;
}

/** Janela do aviso VERMELHO: últimos 5 minutos antes do teto do plano. */
export const VERMELHO_WINDOW_MS = 5 * 60_000;

/**
 * Motor de tempo (seção 6 do plano). Fase segue o contrato validado no
 * protótipo: VERDE até 80% do prazo, AMARELO até os últimos 5 minutos,
 * VERMELHO nos 5 minutos finais (aviso do painel do responsável, ver
 * packages/contracts), EXCEDENTE a partir do minuto seguinte ao teto —
 * e nesse instante o valor total já embute o excedente (D6: nunca
 * aplicado "depois", sempre ao vivo).
 */
export function computeSessionTiming(
  plan: Plan,
  session: Pick<SessionForQuote, "checkinAtMs" | "pausedAtMs" | "pausedMsTotal">,
  nowMs: number,
): SessionTiming {
  const isPaused = session.pausedAtMs != null;
  // Enquanto pausada, o relógio "congela" no instante da pausa: usar
  // pausedAtMs no lugar de nowMs faz o elapsed parar de crescer sem
  // precisar de um branch separado depois.
  const clockMs = session.pausedAtMs ?? nowMs;
  const elapsedMs = Math.max(0, clockMs - session.checkinAtMs - session.pausedMsTotal);
  const pausedForMs = isPaused ? Math.max(0, nowMs - session.pausedAtMs!) : 0;
  const durationMs = planDurationMinutes(plan) * 60_000;
  const overMs = Math.max(0, elapsedMs - durationMs);
  const overMinutes = Math.ceil(overMs / 60_000);
  const overCents = overMinutes * plan.overageCentsPerMinute;
  const liveTotalCents = plan.valueCents + overCents;

  let phase: SessionTiming["phase"];
  if (overMinutes > 0) phase = "EXCEDENTE";
  else if (elapsedMs < durationMs * 0.8) phase = "VERDE";
  else if (elapsedMs >= durationMs - VERMELHO_WINDOW_MS) phase = "VERMELHO";
  else phase = "AMARELO";

  return { elapsedMs, durationMs, overMinutes, overCents, liveTotalCents, phase, isPaused, pausedForMs };
}
