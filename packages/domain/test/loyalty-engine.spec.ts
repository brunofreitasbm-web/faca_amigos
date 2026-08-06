import { describe, expect, it } from "vitest";
import { evaluateLoyaltyRules, type LoyaltyRule } from "../src/loyalty/loyalty-engine.js";
import { FREQUENCY_WINDOW_MS, visitTier } from "../src/loyalty/visit-frequency.js";

describe("evaluateLoyaltyRules", () => {
  const rules: LoyaltyRule[] = [
    { id: "r1", activity: "PLAYGROUND", triggerVisits: 10, rewardKind: "ENTRADA_GRATIS", rewardValue: 1 },
    { id: "r2", activity: "AMBOS", triggerVisits: 7, rewardKind: "DESCONTO_PCT", rewardValue: 20 },
  ];

  it("dispara a regra quando a contagem de visitas bate na régua", () => {
    const earned = evaluateLoyaltyRules("PLAYGROUND", 10, rules, 1000);
    expect(earned).toEqual([{ ruleId: "r1", earnedAtMs: 1000 }]);
  });

  it("regra AMBOS vale para as duas atividades", () => {
    const earned = evaluateLoyaltyRules("CARRINHO", 7, rules, 1000);
    expect(earned).toEqual([{ ruleId: "r2", earnedAtMs: 1000 }]);
  });

  it("não dispara fora da régua", () => {
    expect(evaluateLoyaltyRules("PLAYGROUND", 8, rules, 1000)).toEqual([]);
  });

  it("pode disparar mais de uma regra na mesma visita", () => {
    const both: LoyaltyRule[] = [
      { id: "a", activity: "AMBOS", triggerVisits: 5, rewardKind: "MINUTOS_EXTRA", rewardValue: 10 },
      { id: "b", activity: "AMBOS", triggerVisits: 1, rewardKind: "MINUTOS_EXTRA", rewardValue: 5 },
    ];
    expect(evaluateLoyaltyRules("PLAYGROUND", 5, both, 1000).map((e) => e.ruleId)).toEqual(["a", "b"]);
  });
});

describe("visitTier", () => {
  const now = 10_000_000;

  it("primeira visita não tem selo", () => {
    expect(visitTier([], now)).toBeNull();
  });

  it("2ª visita dentro da janela é RECORRENTE, sem piscar", () => {
    const log = [{ atMs: now - 1000 }, { atMs: now - 500 }];
    const badge = visitTier(log, now);
    expect(badge?.tier).toBe("RECORRENTE");
    expect(badge?.blink).toBe(false);
  });

  it("mais de 3 visitas em 2 meses é FREQUENTE e pisca em vermelho", () => {
    const log = Array.from({ length: 4 }, () => ({ atMs: now - 1000 }));
    const badge = visitTier(log, now);
    expect(badge?.tier).toBe("FREQUENTE");
    expect(badge?.blink).toBe(true);
  });

  it("mais de 8 visitas em 2 meses é VIP e não pisca", () => {
    const log = Array.from({ length: 9 }, () => ({ atMs: now - 1000 }));
    const badge = visitTier(log, now);
    expect(badge?.tier).toBe("VIP");
    expect(badge?.blink).toBe(false);
  });

  it("visitas fora da janela de 2 meses não contam para o nível", () => {
    const log = [
      { atMs: now - FREQUENCY_WINDOW_MS - 1 }, // fora da janela
      { atMs: now - FREQUENCY_WINDOW_MS - 1 },
      { atMs: now - FREQUENCY_WINDOW_MS - 1 },
      { atMs: now - FREQUENCY_WINDOW_MS - 1 },
      { atMs: now - 1000 }, // dentro
    ];
    const badge = visitTier(log, now);
    expect(badge?.totalVisits).toBe(5);
    expect(badge?.recentVisits).toBe(1);
    expect(badge?.tier).toBe("RECORRENTE");
  });
});
