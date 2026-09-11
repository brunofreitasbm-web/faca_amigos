// Placar "ao vivo" do dia do programa de Bonificação (Circuito + Playground)
// mostrado no Painel — mesma fonte de meta/supermeta que
// apps/kiosk-ui/src/lib/apuracaoBonificacao.ts usa para a apuração oficial
// (fa_kiosk_bonus_program_goals/config, configurados pelo Owner em
// Gerencial > Metas). Este módulo só resolve o nível/percentual/estimativa
// do dia a partir da meta já carregada — não sabe nada de trava de abertura
// de caixa nem de divergência de fechamento, porque o Painel não tem esse
// dado à mão durante o turno (só o relatório oficial sabe).

import type { BonusProgramGoal } from "./lib/apuracaoBonificacao.js";

export type UnidadeTipo = "PLAYGROUND" | "CIRCUITO";

/** Dia da semana ISO (1=segunda … 7=domingo) a partir de um business_date "AAAA-MM-DD". */
export function diaSemanaISO(businessDate: string): number {
  const partes = businessDate.split("-").map(Number);
  const y = partes[0] ?? 1970;
  const m = partes[1] ?? 1;
  const d = partes[2] ?? 1;
  const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo
  return jsDow === 0 ? 7 : jsDow;
}

export interface BonificacaoHoje {
  tipo: UnidadeTipo;
  dow: number;
  /** Faturamento (Playground, em centavos) ou nº de locações (Circuito). */
  atual: number;
  meta: number;
  super: number;
  percent: number;
  nivel: "abaixo" | "meta" | "supermeta";
  bonusCents: number;
}

/**
 * Calcula o placar do dia a partir da meta/supermeta já configurada para
 * essa unidade/dia da semana. Retorna null quando a unidade ainda não tem
 * meta configurada (Gerencial > Metas) — o card não deve aparecer nesse
 * caso, nunca mostrar um valor adivinhado.
 */
export function bonificacaoHoje(
  tipo: UnidadeTipo,
  businessDate: string,
  atual: number,
  goal: BonusProgramGoal | null,
  locacaoExtraBonusCents = 0,
): BonificacaoHoje | null {
  if (!goal) return null;
  const dow = diaSemanaISO(businessDate);
  let nivel: BonificacaoHoje["nivel"] = "abaixo";
  let bonusCents = 0;
  if (atual >= goal.superValor) {
    nivel = "supermeta";
    bonusCents = goal.superBonusCents;
  } else if (atual >= goal.metaValor) {
    nivel = "meta";
    bonusCents = goal.metaBonusCents;
  }
  // Circuito: bônus por locação acima da meta, some com o bônus da meta ou
  // da supermeta — mesma regra de apuracaoBonificacao.ts.
  if (tipo === "CIRCUITO" && atual > goal.metaValor) {
    bonusCents += (atual - goal.metaValor) * locacaoExtraBonusCents;
  }
  const percent = goal.superValor > 0 ? Math.min(100, Math.round((atual / goal.superValor) * 100)) : 0;
  return { tipo, dow, atual, meta: goal.metaValor, super: goal.superValor, percent, nivel, bonusCents };
}

export const PILOTO_INICIO = "2026-09-08";
export const PILOTO_FIM = "2026-10-05";

/** true enquanto o business_date de hoje estiver dentro da janela do piloto. */
export function dentroDoPiloto(businessDate: string): boolean {
  return businessDate >= PILOTO_INICIO && businessDate <= PILOTO_FIM;
}
