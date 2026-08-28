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

  it("fica AMARELO entre 80% e os 5 minutos finais (janela só existe em planos mais longos)", () => {
    // Plano de 15 min: os últimos 5 min (10-15) já são VERMELHO, então a
    // janela AMARELO real (80% a "faltam 5min") só aparece em planos onde
    // 80% do prazo é anterior ao início dos 5 min finais. Um plano de 60
    // min tem AMARELO de 48 a 55 min.
    const plano60min: Plan = { ...plan, durationValue: 60 };
    const t = computeSessionTiming(plano60min, { checkinAtMs, ...notPaused }, 50 * 60_000); // 50 de 60 min
    expect(t.phase).toBe("AMARELO");
    expect(t.overMinutes).toBe(0);
  });

  it("fica VERMELHO nos 5 minutos finais antes do teto (aviso do painel do responsável)", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 13 * 60_000); // 13 de 15 min = faltam 2 min
    expect(t.phase).toBe("VERMELHO");
    expect(t.overMinutes).toBe(0);
  });

  it("no exato teto do plano ainda está VERMELHO e não cobra excedente", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000);
    expect(t.overMinutes).toBe(0);
    expect(t.phase).toBe("VERMELHO");
  });

  it("cenário do dono do negócio: plano de 30 min aos 25 min decorridos fica VERMELHO", () => {
    const plano30min: Plan = { ...plan, durationValue: 30 };
    const t = computeSessionTiming(plano30min, { checkinAtMs, ...notPaused }, 25 * 60_000);
    expect(t.phase).toBe("VERMELHO");
    expect(t.overMinutes).toBe(0);
  });

  it("cenário do dono do negócio: plano de 60 min aos 55 min decorridos fica VERMELHO", () => {
    const plano60min: Plan = { ...plan, durationValue: 60 };
    const t = computeSessionTiming(plano60min, { checkinAtMs, ...notPaused }, 55 * 60_000);
    expect(t.phase).toBe("VERMELHO");
    expect(t.overMinutes).toBe(0);
  });

  it("durante o 1º minuto após o teto (tolerância/graça) não cobra excedente e permanece em VERMELHO", () => {
    const t30s = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000 + 30_000); // +30s
    expect(t30s.overMinutes).toBe(0);
    expect(t30s.overCents).toBe(0);
    expect(t30s.liveTotalCents).toBe(3000);
    expect(t30s.phase).toBe("VERMELHO");

    const t60s = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000 + 60_000); // no limite de 1 min de graça
    expect(t60s.overMinutes).toBe(0);
    expect(t60s.overCents).toBe(0);
    expect(t60s.phase).toBe("VERMELHO");
  });

  it("após passar 1 minuto do teto (tolerância), vira EXCEDENTE e inicia a cobrança", () => {
    const t = computeSessionTiming(plan, { checkinAtMs, ...notPaused }, 15 * 60_000 + 60_001); // 1 min + 1 ms após o teto
    expect(t.overMinutes).toBe(1);
    expect(t.overCents).toBe(100);
    expect(t.liveTotalCents).toBe(3100);
    expect(t.phase).toBe("EXCEDENTE");
  });

  it("Day Use de 5h calcula excedente considerando a tolerância de 1 min", () => {
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
    expect(t.overMinutes).toBe(9); // 10 min decorridos além do plano - 1 min de tolerância = 9 min
    expect(t.overCents).toBe(1620); // 9 * 180 = 1620
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
