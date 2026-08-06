/**
 * Selo de frequência mostrado na Entrada (seção do protótipo sobre
 * fidelidade visual). Pedido explícito: "acima de 3 visitas num
 * período de 2 meses, fica piscando em vermelho" — os demais níveis
 * (RECORRENTE, VIP) foram antecipados para dar progressão coerente.
 * Limiares e janela ficam fixos aqui por ora; se a operação quiser
 * ajustá-los sem depender de deploy, o próximo passo natural é migrar
 * para app_settings/Configurações > Fidelidade.
 */
export const FREQUENCY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~2 meses
export const FREQUENCY_TIER_FREQUENTE = 3;
export const FREQUENCY_TIER_VIP = 8;

export type FrequencyTier = "RECORRENTE" | "FREQUENTE" | "VIP";

export interface FrequencyBadge {
  tier: FrequencyTier;
  totalVisits: number;
  recentVisits: number;
  label: string;
  blink: boolean;
}

export interface VisitLogEntry {
  atMs: number;
}

export function visitTier(visitLog: readonly VisitLogEntry[], nowMs: number): FrequencyBadge | null {
  const totalVisits = visitLog.length;
  if (totalVisits === 0) return null;

  const recentVisits = visitLog.filter((v) => nowMs - v.atMs <= FREQUENCY_WINDOW_MS).length;

  if (recentVisits > FREQUENCY_TIER_VIP) {
    return { tier: "VIP", totalVisits, recentVisits, label: `VIP — ${totalVisits} visitas`, blink: false };
  }
  if (recentVisits > FREQUENCY_TIER_FREQUENTE) {
    return { tier: "FREQUENTE", totalVisits, recentVisits, label: `${totalVisits} visitas`, blink: true };
  }
  return {
    tier: "RECORRENTE",
    totalVisits,
    recentVisits,
    label: `${totalVisits} visita${totalVisits > 1 ? "s" : ""}`,
    blink: false,
  };
}
