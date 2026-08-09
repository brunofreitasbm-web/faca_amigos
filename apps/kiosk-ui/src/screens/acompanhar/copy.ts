import type { SessionPhase } from "@facaamigos/domain";

/**
 * Texto do painel do responsável. Tom acolhedor, nunca punitivo — regra
 * explícita do dono do negócio: nunca "multa"/"tempo esgotado", sempre
 * reforçar que a criança está bem cuidada.
 */

const SENSORY_ZONES: Record<string, string> = {
  CALMARIA: "na Zona de Calmaria",
  SENSORIAL: "na Zona Sensorial",
  MOTORA: "na Zona de Movimento",
};

export function statusHeadline(childFirstName: string, phase: SessionPhase | "PAUSADA", sensoryTags: string[]): string {
  const zone = sensoryTags.map((t) => SENSORY_ZONES[t]).find(Boolean);
  const lugar = zone ?? "brincando com nossos educadores";
  if (phase === "PAUSADA") return `${childFirstName} está em uma pausa tranquila com a equipe.`;
  if (phase === "EXCEDENTE") return `${childFirstName} está tão bem que nem percebeu o tempo passar, ${lugar}.`;
  if (phase === "VERMELHO") return `${childFirstName} está se divertindo ${lugar} — já, já o tempo contratado termina.`;
  return `${childFirstName} está se divertindo ${lugar}.`;
}

/** Bloco de renovação — mesmos valores para qualquer duração de plano (regra do dono do negócio). */
export const RENEWAL_OPTIONS = [
  { minutes: 15, cents: 3000, highlight: false },
  { minutes: 30, cents: 4800, highlight: true },
  { minutes: 60, cents: 9600, highlight: false },
] as const;

export const OVERAGE_RATE_CENTS_PER_MINUTE = 300;

export function renewalIntro(planDurationMinutes: number, childFirstName: string): string {
  if (planDurationMinutes === 30) {
    return `${childFirstName} está acolhido(a) e aproveitando bastante! Faltam só alguns minutinhos do pacote de 30 minutos — que tal garantir mais um tempinho tranquilo, sem pressa nenhuma?`;
  }
  if (planDurationMinutes === 60) {
    return `${childFirstName} está tranquilo(a) e em boas mãos! A 1 hora contratada está quase completa — dá pra estender com calma para terminar o que precisar por perto, sem correria.`;
  }
  return `${childFirstName} está bem e acompanhado(a)! Faltam poucos minutos do tempo contratado — se quiser, dá para renovar agora mesmo, sem precisar ir até o balcão.`;
}

export function renewalHighlightAnchor(planDurationMinutes: number): string {
  if (planDurationMinutes === 30) return "Complete 1 hora pagando apenas a diferença do balcão (R$ 48,00)! Total = R$ 108,00.";
  if (planDurationMinutes === 60) return "Ganhe mais 30 minutos de tranquilidade para terminar com calma o que precisar.";
  return "A opção mais escolhida por quem quer mais tempo tranquilo.";
}
