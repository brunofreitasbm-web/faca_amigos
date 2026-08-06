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
const notPaused = { pausedAtMs: null, pausedMsTotal: 0 };

describe("computeSessionTiming", () => {
  it("fica VERDE antes de 80% do prazo", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 5 * 60_000); // 5 de 15 min
    expect(t.phase).toBe("VERDE");
    expect(t.overMinutes).toBe(0);
    expect(t.liveTotalCents).toBe(3000);
  });

  it("fica AMARELO entre 80% e o teto", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 13 * 60_000); // 13 de 15 min = 86.6%
    expect(t.phase).toBe("AMARELO");
    expect(t.overMinutes).toBe(0);
  });

  it("no exato teto do plano ainda não cobra excedente", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000);
    expect(t.overMinutes).toBe(0);
    expect(t.phase).toBe("AMARELO");
  });

  it("um minuto após o teto já cobra e vira EXCEDENTE", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000 + 1);
    expect(t.overMinutes).toBe(1);
    expect(t.overCents).toBe(100);
    expect(t.liveTotalCents).toBe(3100);
    expect(t.phase).toBe("EXCEDENTE");
  });

  it("arredonda o excedente para cima por minuto (fração de 1 min)", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000 + 30_000); // +30s
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
    const t = computeSessionTiming(dayUse, { checkinAtMs, ...notPaused }, 5 * 60 * 60_000 + 10 * 60_000); // +10 min
    expect(t.overMinutes).toBe(10);
    expect(t.overCents).toBe(1800);
    expect(t.phase).toBe("EXCEDENTE");
  });

  it("tempo pausado não conta como elapsed", () => {
    // Sessão de 20 min corridos, mas 10 min ficaram pausados (já
    // encerrados) — elapsed cobrável deve ser só 10 min, não 20.
    const t = computeSessionTiming(plan, { checkinAtMs, pausedAtMs: null, pausedMsTotal: 10 * 60_000 }, 20 * 60_000);
    expect(t.elapsedMs).toBe(10 * 60_000);
    expect(t.overMinutes).toBe(0);
    expect(t.isPaused).toBe(false);
  });

  it("enquanto pausada, o relógio congela no instante da pausa", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, pausedAtMs: 5 * 60_000, pausedMsTotal: 0 }, 25 * 60_000);
    expect(t.isPaused).toBe(true);
    expect(t.elapsedMs).toBe(5 * 60_000);
    expect(t.pausedForMs).toBe(20 * 60_000);
    expect(t.phase).toBe("VERDE");
  });
});
