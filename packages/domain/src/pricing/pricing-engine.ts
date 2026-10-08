import { computeSessionTiming, isFreeStay } from "../time/session-timer.js";
import type { Plan, QuoteLine, SessionForQuote, SessionQuote, SessionTiming } from "./types.js";

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
export function quoteForSession(
  plan: Plan,
  session: SessionForQuote,
  nowMs: number,
  options: { applyFreeStay?: boolean } = {},
): SessionQuote {
  const timing = computeSessionTiming(plan, session, nowMs);
  const lines: QuoteLine[] = [{ label: `${session.childName} — ${plan.name}`, cents: plan.valueCents }];

  // Tolerância de saída imediata (interna, só no fechamento): a linha do plano
  // sai zerada e nenhum excedente/cortesia entra. Pacote comprado no ato
  // mantém o preço do pacote (compra, não tempo). Espelha fa_checkout.
  if (options.applyFreeStay && isFreeStay(session, nowMs)) {
    const baseCents = session.freeStayKeepsPlanValue ? plan.valueCents : 0;
    lines[0] = { label: lines[0]!.label, cents: baseCents };
    return finishQuote(plan, session, timing, lines, baseCents);
  }

  if (timing.overMinutes > 0) {
    lines.push({
      label: `Excedente (${timing.overMinutes} min × ${money(plan.overageCentsPerMinute)})`,
      cents: timing.overCents,
    });
  }

  let totalCents = timing.liveTotalCents;

  // Cortesia de fidelidade (10ª visita): o relógio já andou N min a menos
  // (computeSessionTiming). Se a permanência inteira cabe na cortesia, o
  // plano avulso sai de graça — espelha fa_checkout.
  const courtesyMinutes = session.loyaltyCourtesyMinutes ?? 0;
  if (courtesyMinutes > 0) {
    lines.push({ label: `Cortesia de fidelidade — ${courtesyMinutes} min grátis`, cents: 0 });
    const clockMs = session.pausedAtMs ?? nowMs;
    const stayedMs = Math.max(0, clockMs - session.checkinAtMs - session.pausedMsTotal);
    if (session.courtesyZeroesPlan && stayedMs <= courtesyMinutes * 60_000) {
      lines.push({ label: `Plano coberto pela cortesia`, cents: -totalCents });
      totalCents = 0;
    }
  }

  return finishQuote(plan, session, timing, lines, totalCents);
}

function finishQuote(
  plan: Plan,
  session: SessionForQuote,
  timing: SessionTiming,
  lines: QuoteLine[],
  startCents: number,
): SessionQuote {
  let totalCents = startCents;

  // Cupom percentual (o par 50% inclusivo / 40% padrão) recalcula sobre o
  // valor total ao vivo — que já inclui o excedente — em vez de reusar o
  // valor fixo travado no check-in, e só vale para Playground. Cupom de
  // valor fixo (DESCONTO_VALOR) continua sendo subtraído direto.
  const discountCents =
    session.couponKind === "DESCONTO_PCT" && session.activity === "PLAYGROUND" && session.couponPct
      ? Math.round((totalCents * session.couponPct) / 100)
      : session.couponDiscountCents;

  if (discountCents > 0 && totalCents > 0) {
    const applied = Math.min(discountCents, totalCents);
    lines.push({ label: `Cupom ${session.couponCode ?? ""}`.trim(), cents: -applied });
    totalCents -= applied;
  }

  if (session.freeFromLoyalty) {
    lines.push({ label: "Cortesia — resgate de fidelidade", cents: -totalCents });
    totalCents = 0;
  }

  return { plan, timing, lines, totalCents: Math.max(0, totalCents) };
}
