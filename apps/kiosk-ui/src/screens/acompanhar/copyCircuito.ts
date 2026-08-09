/**
 * Regras de alerta e renovação do Faça Amigos Circuito (carrinhos elétricos
 * e pelúcias) — painel do responsável. Ao contrário do Playground (mesmo
 * alerta/opções para qualquer duração), aqui cada combinação de tabela
 * (asset_kind + duração do plano) tem um minuto de alerta e um conjunto de
 * opções próprios, definidos pelo dono do negócio. Tom: prático, simpático,
 * ágil — foco na comodidade dos pais, nunca em pressão ou "tempo esgotado".
 */
import { money } from "@facaamigos/domain";

export type CircuitoAssetKind = "CARRO" | "PELUCIA";

export interface CircuitoRenewalOption {
  minutes: number;
  cents: number;
  highlight: boolean;
  highlightMessage?: string;
}

export interface CircuitoAlertConfig {
  /** Minuto decorrido (desde o check-in) em que o alerta passa a ser exibido. */
  alertAtMinutes: number;
  options: readonly CircuitoRenewalOption[];
}

const CIRCUITO_ALERTS: Record<CircuitoAssetKind, Record<number, CircuitoAlertConfig>> = {
  CARRO: {
    15: {
      alertAtMinutes: 12,
      options: [
        { minutes: 10, cents: 1800, highlight: false },
        {
          minutes: 15,
          cents: 2300,
          highlight: true,
          highlightMessage: "Complete 30 min pelo valor da Tabela de Balcão - Total R$ 48,00!",
        },
        { minutes: 30, cents: 4400, highlight: false },
      ],
    },
    30: {
      alertAtMinutes: 25,
      options: [
        { minutes: 10, cents: 1800, highlight: false },
        { minutes: 15, cents: 2400, highlight: true },
        { minutes: 30, cents: 4400, highlight: false },
      ],
    },
  },
  PELUCIA: {
    10: {
      alertAtMinutes: 7,
      options: [
        { minutes: 5, cents: 1500, highlight: false },
        {
          minutes: 10,
          cents: 2300,
          highlight: true,
          highlightMessage: "Complete 20 min pelo valor da Tabela de Balcão - Total R$ 48,00!",
        },
        { minutes: 20, cents: 4400, highlight: false },
      ],
    },
    20: {
      alertAtMinutes: 16,
      options: [
        { minutes: 5, cents: 1500, highlight: false },
        { minutes: 10, cents: 2400, highlight: true },
        { minutes: 20, cents: 4400, highlight: false },
      ],
    },
  },
};

/** null quando a combinação (asset_kind, duração) não corresponde a nenhuma tabela do Circuito conhecida. */
export function getCircuitoAlertConfig(
  assetKind: CircuitoAssetKind | null,
  planDurationMinutes: number,
): CircuitoAlertConfig | null {
  if (!assetKind) return null;
  return CIRCUITO_ALERTS[assetKind]?.[planDurationMinutes] ?? null;
}

export const CIRCUITO_OVERAGE_RATE_CENTS_PER_MINUTE = 300;

export function circuitoStatusHeadline(childFirstName: string, phase: string, assetKind: CircuitoAssetKind): string {
  const veiculo = assetKind === "PELUCIA" ? "na pelúcia" : "no carrinho elétrico";
  if (phase === "PAUSADA") return `${childFirstName} está em uma pausa tranquila com a equipe.`;
  if (phase === "EXCEDENTE") return `${childFirstName} está aproveitando tanto que nem viu o tempo passar, ${veiculo}!`;
  return `${childFirstName} está curtindo o passeio ${veiculo}.`;
}

export function circuitoRenewalIntro(childFirstName: string): string {
  return `${childFirstName} está quase completando o tempo do passeio! Que tal renovar agora, sem precisar ir até o balcão?`;
}

export function circuitoAnchorMessage(): string {
  return `Sem pressa: o minuto excedente não renovado no balcão custa ${money(CIRCUITO_OVERAGE_RATE_CENTS_PER_MINUTE)}/min — renovar agora garante o valor combinado.`;
}
