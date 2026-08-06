import { describe, expect, it } from "vitest";
import { computeSessionTiming } from "../src/time/session-timer.js";
import type { Plan } from "../src/pricing/types.js";

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

const checkinAtMs = 0;

describe("computeSessionTiming", () => {
  it("fica VERDE antes de 80% do prazo", () => {
    const t = computeSessionTiming(plan, { checkinAtMs }, 5 * 60_000); // 5 de 15 min
    expect(t.phase).toBe("VERDE");
    expect(t.overMinutes).toBe(0);
    expect(t.liveTotalCents).toBe(3000);
  });

  it("fica AMARELO entre 80% e o teto", () => {
    const t = computeSessionTiming(plan, { checkinAtMs }, 13 * 60_000); // 13 de 15 min = 86.6%
    expect(t.phase).toBe("AMARELO");
    expect(t.overMinutes).toBe(0);
  });

  it("no exato teto do plano ainda não cobra excedente", () => {
    const t = computeSessionTiming(plan, { checkinAtMs }, 15 * 60_000);
    expect(t.overMinutes).toBe(0);
    expect(t.phase).toBe("AMARELO");
  });

  it("um minuto após o teto já cobra e vira EXCEDENTE", () => {
    const t = computeSessionTiming(plan, { checkinAtMs }, 15 * 60_000 + 1);
    expect(t.overMinutes).toBe(1);
    expect(t.overCents).toBe(100);
    expect(t.liveTotalCents).toBe(3100);
    expect(t.phase).toBe("EXCEDENTE");
  });

  it("arredonda o excedente para cima por minuto (fração de 1 min)", () => {
    const t = computeSessionTiming(plan, { checkinAtMs }, 15 * 60_000 + 30_000); // +30s
    expect(t.overMinutes).toBe(1);
  });

  it("Day Use de 5h calcula excedente em horas convertidas para minutos", () => {
    const dayUse: Plan = {
      id: "plan-day-use",
      activity: "PLAYGROUND",
      name: "Day Use (5h)",
      valueCents: 27000,
      durationValue: 5,
      durationUnit: "HORA",
      overageCentsPerMinute: 180,
      color: "#A020EE",
    };
    const t = computeSessionTiming(dayUse, { checkinAtMs }, 5 * 60 * 60_000 + 10 * 60_000); // +10 min
    expect(t.overMinutes).toBe(10);
    expect(t.overCents).toBe(1800);
    expect(t.phase).toBe("EXCEDENTE");
  });
});
