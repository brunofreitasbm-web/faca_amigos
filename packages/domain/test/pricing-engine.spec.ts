import { describe, expect, it } from "vitest";
import { money, quoteForSession } from "../src/pricing/pricing-engine.js";
import type { Plan, SessionForQuote } from "../src/pricing/types.js";

const plan: Plan = {
  id: "plan-1",
  activity: "CARRINHO",
  name: "15 minutos",
  valueCents: 3000,
  durationValue: 15,
  durationUnit: "MINUTO",
  overageCentsPerMinute: 100,
  color: "#2ECFB5",
};

function session(overrides: Partial<SessionForQuote> = {}): SessionForQuote {
  return {
    checkinAtMs: 0,
    childName: "Helena",
    planId: plan.id,
    couponDiscountCents: 0,
    couponCode: null,
    freeFromLoyalty: false,
    pausedAtMs: null,
    pausedMsTotal: 0,
    ...overrides,
  };
}

describe("quoteForSession", () => {
  it("cobra só o valor do plano dentro do prazo", () => {
    const q = quoteForSession(plan, session(), 5 * 60_000);
    expect(q.totalCents).toBe(3000);
    expect(q.lines).toHaveLength(1);
  });

  it("soma o excedente como linha separada", () => {
    const q = quoteForSession(plan, session(), 15 * 60_000 + 3 * 60_000); // +3 min
    expect(q.totalCents).toBe(3000 + 300);
    expect(q.lines.map((l) => l.label)).toEqual(["Helena — 15 minutos", `Excedente (3 min × ${money(100)})`]);
  });

  it("aplica cupom antes da cortesia de fidelidade, e cupom nunca deixa o total negativo", () => {
    const q = quoteForSession(plan, session({ couponDiscountCents: 5000, couponCode: "AMIGO10" }), 5 * 60_000);
    expect(q.totalCents).toBe(0);
    expect(q.lines.at(-1)).toEqual({ label: "Cupom AMIGO10", cents: -3000 });
  });

  it("cortesia de fidelidade zera o total mesmo com excedente e cupom já aplicados", () => {
    const q = quoteForSession(
      plan,
      session({ couponDiscountCents: 500, couponCode: "AMIGO10", freeFromLoyalty: true }),
      15 * 60_000 + 60_000,
    );
    expect(q.totalCents).toBe(0);
    expect(q.lines.at(-1)?.label).toBe("Cortesia — resgate de fidelidade");
  });
});
