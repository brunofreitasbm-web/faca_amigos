import { describe, expect, it } from "vitest";
import { calculatePrepaidDeduction, quotePrepaidSession } from "../src/pricing/prepaid-engine.js";
import type { Plan } from "../src/pricing/types.js";

const mockPlan: Plan = {
  id: "plan-porto-seguro",
  activity: "PLAYGROUND",
  name: "Porto Seguro 60 Minutos",
  valueCents: 6000,
  durationValue: 60,
  durationUnit: "MINUTO",
  overageCentsPerMinute: 100, // R$ 1,00/min excedente
  color: "#10B981",
};

describe("prepaid-engine", () => {
  it("abate minutos totalmente do saldo pré-pago quando houver saldo suficiente", () => {
    const res = calculatePrepaidDeduction({
      availablePrepaidMinutes: 60,
      sessionDurationMinutes: 45,
      overageCentsPerMinute: 100,
    });

    expect(res.minutesDeductedFromPrepaid).toBe(45);
    expect(res.remainingPrepaidMinutes).toBe(15);
    expect(res.excessMinutesToCharge).toBe(0);
    expect(res.excessCentsToCharge).toBe(0);
  });

  it("calcula excedente quando o tempo de uso supera o saldo pré-pago disponível", () => {
    const res = calculatePrepaidDeduction({
      availablePrepaidMinutes: 30,
      sessionDurationMinutes: 50,
      overageCentsPerMinute: 100,
    });

    expect(res.minutesDeductedFromPrepaid).toBe(30);
    expect(res.remainingPrepaidMinutes).toBe(0);
    expect(res.excessMinutesToCharge).toBe(20);
    expect(res.excessCentsToCharge).toBe(2000); // 20 min * R$ 1,00 = R$ 20,00
  });

  it("gera cotação zerada para sessão coberta integralmente pelo Porto Seguro", () => {
    const quote = quotePrepaidSession(mockPlan, "Pedro Silva", 40, 60);

    expect(quote.totalCents).toBe(0);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].label).toContain("Porto Seguro Pré-pago (40 min debitados)");
  });

  it("gera cotação com linha de excedente quando o saldo Porto Seguro acaba durante a sessão", () => {
    const quote = quotePrepaidSession(mockPlan, "Pedro Silva", 75, 60);

    expect(quote.totalCents).toBe(1500); // 15 min excedentes * R$ 1,00
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines[1].label).toContain("Tempo Excedente ao Porto Seguro (15 min ×");
  });
});
