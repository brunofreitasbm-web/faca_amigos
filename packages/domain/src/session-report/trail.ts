/**
 * Trilha de Olhares — cada criança tem uma sequência (1º, 2º, 3º…) e cada Olhar
 * é diferente do anterior: ESTREIA (1º), CONTINUIDADE e MARCO (retrospectiva com
 * painel de conquistas). Regras puras, sem IO.
 *
 * Blindagem: nada aqui compara níveis para baixo, calcula nota/média/percentual
 * ou indica "evolução". O painel só soma momentos AUTONOMO vistos (só sobe).
 *
 * O Deno não enxerga `packages/`: `supabase/functions/_shared/sessionReportTrail.ts`
 * é cópia deste arquivo (muda só o import do catálogo; o teste confere).
 */

import {
  SESSION_REPORT_CATALOG,
  type EmployeeSector,
  type SessionReportAnswers,
} from "./catalog.js";

export type OlharEdition = "ESTREIA" | "CONTINUIDADE" | "MARCO";

export interface OlharTrailHistoryItem {
  id: string;
  filledAtMs: number;
  eligibleMinutes: number;
  answers: SessionReportAnswers;
}

export interface OlharTrail {
  seq: number;
  edition: OlharEdition;
  nextMilestone: number;
  /** Só coisas positivas: itens vistos pela 1ª vez e itens feitos com autonomia pela 1ª vez. */
  novidades: { primeiraVez: string[]; primeiraAutonomia: string[] };
  /** Momentos "fez com autonomia" somados até este Olhar, por área. Só sobe. */
  conquistasPorArea: Record<EmployeeSector, number>;
  itensExplorados: number;
  totalItens: number;
  visitas: { atMs: number; minutes: number }[];
  totalMinutos: number;
  /** Área aprofundada neste Olhar (null na ESTREIA, que mostra tudo). */
  spotlight: EmployeeSector | null;
}

export const OLHAR_TRAIL_INTRO =
  "A cada visita de 1 hora ou mais, a equipe registra um novo Olhar. Os próximos trazem novidades e um destaque diferente. No 3º Olhar vem a primeira retrospectiva, com o caminho de brincadeiras de vocês.";

export const OLHAR_TRAIL_CHART_NOTE =
  "Este painel soma momentos que a equipe viu durante as brincadeiras. Não mede desempenho, não compara crianças e não indica progresso clínico ou escolar.";

const ITEM_LABEL = new Map<string, string>(SESSION_REPORT_CATALOG.flatMap((s) => s.items.map((i) => [i.key, i.label] as const)));
const ITEM_SECTOR = new Map<string, EmployeeSector>(SESSION_REPORT_CATALOG.flatMap((s) => s.items.map((i) => [i.key, s.sector] as const)));

/** 3º, 5º, 10º e depois a cada 5 (15º, 20º…). */
export function isOlharMilestone(seq: number): boolean {
  return seq === 3 || seq === 5 || (seq >= 10 && seq % 5 === 0);
}

export function nextOlharMilestone(seq: number): number {
  let n = Math.max(seq, 0) + 1;
  while (!isOlharMilestone(n)) n++;
  return n;
}

export function olharEdition(seq: number): OlharEdition {
  if (seq <= 1) return "ESTREIA";
  return isOlharMilestone(seq) ? "MARCO" : "CONTINUIDADE";
}

export function olharOrdinal(seq: number): string {
  return `${seq}º`;
}

/** Área aprofundada: roda entre as áreas respondidas conforme o nº do Olhar. */
export function spotlightSector(seq: number, answeredSectors: readonly EmployeeSector[]): EmployeeSector | null {
  if (seq <= 1 || answeredSectors.length === 0) return null;
  return answeredSectors[seq % answeredSectors.length]!;
}

/**
 * `history` em ordem cronológica, incluindo o Olhar atual. Chaves fora do
 * catálogo atual (versões antigas) são ignoradas.
 */
export function buildOlharTrail(history: readonly OlharTrailHistoryItem[], currentId: string): OlharTrail {
  const idx = history.findIndex((h) => h.id === currentId);
  const upto = idx >= 0 ? history.slice(0, idx + 1) : [...history];
  const seq = upto.length;
  const current = idx >= 0 ? history[idx]!.answers : {};
  const previous = idx >= 0 ? history.slice(0, idx) : history;

  const seen = new Set<string>();
  const seenAutonomo = new Set<string>();
  for (const h of previous) {
    for (const [k, v] of Object.entries(h.answers)) {
      if (!ITEM_LABEL.has(k) || !v) continue;
      seen.add(k);
      if (v === "AUTONOMO") seenAutonomo.add(k);
    }
  }

  const primeiraVez: string[] = [];
  const primeiraAutonomia: string[] = [];
  const answeredSectors = new Set<EmployeeSector>();
  for (const s of SESSION_REPORT_CATALOG) {
    for (const item of s.items) {
      const level = current[item.key];
      if (!level) continue;
      answeredSectors.add(s.sector);
      if (seq <= 1) continue;
      if (!seen.has(item.key)) primeiraVez.push(item.label);
      else if (level === "AUTONOMO" && !seenAutonomo.has(item.key)) primeiraAutonomia.push(item.label);
    }
  }

  const conquistasPorArea = Object.fromEntries(SESSION_REPORT_CATALOG.map((s) => [s.sector, 0])) as Record<EmployeeSector, number>;
  const explorados = new Set<string>();
  for (const h of upto) {
    for (const [k, v] of Object.entries(h.answers)) {
      const sector = ITEM_SECTOR.get(k);
      if (!sector || !v) continue;
      explorados.add(k);
      if (v === "AUTONOMO") conquistasPorArea[sector] += 1;
    }
  }

  const visitas = upto.map((h) => ({ atMs: h.filledAtMs, minutes: h.eligibleMinutes }));
  return {
    seq,
    edition: olharEdition(seq),
    nextMilestone: nextOlharMilestone(seq),
    novidades: { primeiraVez, primeiraAutonomia },
    conquistasPorArea,
    itensExplorados: explorados.size,
    totalItens: ITEM_LABEL.size,
    visitas,
    totalMinutos: visitas.reduce((a, v) => a + v.minutes, 0),
    spotlight: spotlightSector(seq, SESSION_REPORT_CATALOG.filter((s) => answeredSectors.has(s.sector)).map((s) => s.sector)),
  };
}
