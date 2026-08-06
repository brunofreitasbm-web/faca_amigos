export interface LoyaltyRule {
  id: string;
  activity: "PLAYGROUND" | "CARRINHO" | "AMBOS";
  triggerVisits: number;
  rewardKind: "ENTRADA_GRATIS" | "DESCONTO_PCT" | "MINUTOS_EXTRA";
  rewardValue: number;
}

export interface EarnedReward {
  ruleId: string;
  earnedAtMs: number;
}

export function describeLoyaltyReward(rule: LoyaltyRule): string {
  if (rule.rewardKind === "ENTRADA_GRATIS") return "Entrada grátis";
  if (rule.rewardKind === "DESCONTO_PCT") return `${rule.rewardValue}% de desconto`;
  return `${rule.rewardValue} minutos extras`;
}

/**
 * Avalia as regras de fidelidade após uma visita já contabilizada e
 * devolve as recompensas recém-conquistadas (seção "Programa de
 * Fidelidade" do protótipo — ex.: a cada 10 visitas, 1 grátis).
 * Não muta nada: quem chama decide como persistir visits/rewards.
 */
export function evaluateLoyaltyRules(
  activity: "PLAYGROUND" | "CARRINHO",
  visitsAfter: number,
  rules: readonly LoyaltyRule[],
  nowMs: number,
): EarnedReward[] {
  const earned: EarnedReward[] = [];
  for (const rule of rules) {
    if (rule.activity !== activity && rule.activity !== "AMBOS") continue;
    if (rule.triggerVisits > 0 && visitsAfter % rule.triggerVisits === 0) {
      earned.push({ ruleId: rule.id, earnedAtMs: nowMs });
    }
  }
  return earned;
}
