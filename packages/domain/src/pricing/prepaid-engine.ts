import { money } from "./pricing-engine.js";
import type { Plan, QuoteLine, SessionQuote, SessionTiming } from "./types.js";

export interface PrepaidCalculationInput {
  availablePrepaidMinutes: number;
  sessionDurationMinutes: number;
  overageCentsPerMinute: number;
}

export interface PrepaidCalculationResult {
  minutesDeductedFromPrepaid: number;
  remainingPrepaidMinutes: number;
  excessMinutesToCharge: number;
  excessCentsToCharge: number;
}

/**
 * Calcula o abatimento de saldo pré-pago Porto Seguro para uma sessão de brincadeira.
 */
export function calculatePrepaidDeduction(input: PrepaidCalculationInput): PrepaidCalculationResult {
  const { availablePrepaidMinutes, sessionDurationMinutes, overageCentsPerMinute } = input;

  const minutesDeductedFromPrepaid = Math.min(availablePrepaidMinutes, sessionDurationMinutes);
  const remainingPrepaidMinutes = Math.max(0, availablePrepaidMinutes - minutesDeductedFromPrepaid);
  const excessMinutesToCharge = Math.max(0, sessionDurationMinutes - availablePrepaidMinutes);
  const excessCentsToCharge = excessMinutesToCharge * overageCentsPerMinute;

  return {
    minutesDeductedFromPrepaid,
    remainingPrepaidMinutes,
    excessMinutesToCharge,
    excessCentsToCharge,
  };
}

/**
 * Ajusta a cotação da sessão quando ela é paga por saldo pré-pago (Porto Seguro).
 */
export function quotePrepaidSession(
  plan: Plan,
  childName: string,
  sessionDurationMinutes: number,
  availablePrepaidMinutes: number,
): SessionQuote {
  const calc = calculatePrepaidDeduction({
    availablePrepaidMinutes,
    sessionDurationMinutes,
    overageCentsPerMinute: plan.overageCentsPerMinute,
  });

  const lines: QuoteLine[] = [
    {
      label: `${childName} — Porto Seguro Pré-pago (${calc.minutesDeductedFromPrepaid} min debitados)`,
      cents: 0,
    },
  ];

  if (calc.excessMinutesToCharge > 0) {
    lines.push({
      label: `Tempo Excedente ao Porto Seguro (${calc.excessMinutesToCharge} min × ${money(plan.overageCentsPerMinute)})`,
      cents: calc.excessCentsToCharge,
    });
  }

  const timing: SessionTiming = {
    elapsedMs: sessionDurationMinutes * 60_000,
    durationMs: calc.minutesDeductedFromPrepaid * 60_000,
    overMinutes: calc.excessMinutesToCharge,
    overCents: calc.excessCentsToCharge,
    liveTotalCents: calc.excessCentsToCharge,
    phase: calc.excessMinutesToCharge > 0 ? "EXCEDENTE" : "VERDE",
    isPaused: false,
    pausedForMs: 0,
  };

  return {
    plan,
    timing,
    lines,
    totalCents: calc.excessCentsToCharge,
  };
}
