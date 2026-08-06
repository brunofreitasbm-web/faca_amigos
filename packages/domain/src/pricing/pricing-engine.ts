import { computeSessionTiming } from "../time/session-timer.js";
import type { Plan, QuoteLine, SessionForQuote, SessionQuote } from "./types.js";

export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Cotação ao vivo de uma sessão (seção 6 do plano). Ordem de aplicação
 * dos descontos é fixa e documentada porque muda o resultado: cupom
 * primeiro, cortesia de fidelidade por último — a cortesia zera o que
 * sobrar, então aplicá-la antes do cupom esconderia o desconto do
 * cupom no comprovante (o cliente precisa ver os dois na linha).
 */
export function quoteForSession(plan: Plan, session: SessionForQuote, nowMs: number): SessionQuote {
  const timing = computeSessionTiming(plan, session, nowMs);
  const lines: QuoteLine[] = [{ label: `${session.childName} — ${plan.name}`, cents: plan.valueCents }];

  if (timing.overMinutes > 0) {
    lines.push({
      label: `Excedente (${timing.overMinutes} min × ${money(plan.overageCentsPerMinute)})`,
      cents: timing.overCents,
    });
  }

  let totalCents = timing.liveTotalCents;

  if (session.couponDiscountCents > 0) {
    const applied = Math.min(session.couponDiscountCents, totalCents);
    lines.push({ label: `Cupom ${session.couponCode ?? ""}`.trim(), cents: -applied });
    totalCents -= applied;
  }

  if (session.freeFromLoyalty) {
    lines.push({ label: "Cortesia — resgate de fidelidade", cents: -totalCents });
    totalCents = 0;
  }

  return { plan, timing, lines, totalCents: Math.max(0, totalCents) };
}
