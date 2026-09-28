/**
 * Relatório de Sessão — catálogo versionado e regras puras.
 *
 * Fonte única para a SPA. O Deno (edge functions) não enxerga `packages/`, então
 * `supabase/functions/_shared/sessionReportCatalog.ts` guarda uma cópia; o teste
 * `catalog.test.ts` falha se as duas divergirem.
 *
 * Mexeu nos itens? Suba SESSION_REPORT_CATALOG_VERSION: relatórios antigos
 * guardam a versão com que foram preenchidos.
 */

export const SESSION_REPORT_CATALOG_VERSION = 1;
/** Prazo para preencher, contado do checkout. Passou disso = "atrasado" (não bloqueia). */
export const SESSION_REPORT_DEADLINE_MS = 40 * 60_000;
/** Só sessões com pelo menos esta duração contratada geram relatório. */
export const SESSION_REPORT_MIN_MINUTES = 60;

export const SESSION_REPORT_LEVELS = ["APOIO", "DESENVOLVENDO", "AUTONOMO"] as const;
export type SessionReportLevel = (typeof SESSION_REPORT_LEVELS)[number];

export const SESSION_REPORT_LEVEL_LABEL: Record<SessionReportLevel, { short: string; long: string; emoji: string }> = {
  APOIO: { short: "Com apoio", long: "Precisou de apoio", emoji: "🤝" },
  DESENVOLVENDO: { short: "Desenvolvendo", long: "Em desenvolvimento", emoji: "🌱" },
  AUTONOMO: { short: "Autônomo", long: "Fez com autonomia", emoji: "⭐" },
};

export const EMPLOYEE_SECTORS = ["EDUCACAO_FISICA", "PSICOLOGIA", "TERAPIA_OCUPACIONAL", "PEDAGOGIA"] as const;
export type EmployeeSector = (typeof EMPLOYEE_SECTORS)[number];

export const EMPLOYEE_SECTOR_LABEL: Record<EmployeeSector, string> = {
  EDUCACAO_FISICA: "Educação Física",
  PSICOLOGIA: "Psicologia",
  TERAPIA_OCUPACIONAL: "Terapia Ocupacional",
  PEDAGOGIA: "Pedagogia",
};

export interface SessionReportItem {
  key: string;
  label: string;
  /** O que observar — aparece em cinza sob o rótulo. */
  hint: string;
}

export interface SessionReportSector {
  sector: EmployeeSector;
  label: string;
  emoji: string;
  items: readonly SessionReportItem[];
}

export const SESSION_REPORT_CATALOG: readonly SessionReportSector[] = [
  {
    sector: "EDUCACAO_FISICA",
    label: "Educação Física",
    emoji: "🏃",
    items: [
      { key: "ef.coordenacao_ampla", label: "Coordenação motora ampla", hint: "correr, pular, escalar, arremessar" },
      { key: "ef.equilibrio", label: "Equilíbrio", hint: "andar em linha, ficar num pé só, subir e descer" },
      { key: "ef.resistencia", label: "Resistência e ritmo", hint: "manteve a energia na atividade, não desistiu logo" },
      { key: "ef.planejamento_motor", label: "Planejamento motor", hint: "organiza o corpo em tarefa nova (circuito, obstáculo)" },
    ],
  },
  {
    sector: "PSICOLOGIA",
    label: "Psicologia",
    emoji: "💛",
    items: [
      { key: "psi.regulacao_emocional", label: "Regulação emocional", hint: "voltou à calma sozinha ou com ajuda após algo difícil" },
      { key: "psi.interacao_social", label: "Interação social", hint: "aproximou-se, brincou e conversou com outras crianças" },
      { key: "psi.tolerancia_frustracao", label: "Tolerância à frustração", hint: "lidou com espera, perda ou o \"não\"" },
      { key: "psi.brincar_compartilhado", label: "Brincar compartilhado e imaginativo", hint: "dividiu brinquedos, propôs ou entrou em faz de conta" },
    ],
  },
  {
    sector: "TERAPIA_OCUPACIONAL",
    label: "Terapia Ocupacional",
    emoji: "✋",
    items: [
      { key: "to.motricidade_fina", label: "Motricidade fina", hint: "pegar, encaixar, manipular objetos pequenos" },
      { key: "to.processamento_sensorial", label: "Processamento sensorial", hint: "reação a barulho, toque, movimento e texturas" },
      { key: "to.autonomia_atividades", label: "Autonomia nas atividades", hint: "iniciou e conduziu a brincadeira sem ajuda" },
      { key: "to.transicoes", label: "Transições entre atividades", hint: "trocou de brinquedo ou espaço sem grande desconforto" },
    ],
  },
  {
    sector: "PEDAGOGIA",
    label: "Pedagogia",
    emoji: "📚",
    items: [
      { key: "ped.atencao_foco", label: "Atenção e foco", hint: "permaneceu na atividade até concluir" },
      { key: "ped.seguir_instrucoes", label: "Seguir instruções", hint: "compreendeu e executou combinados e regras" },
      { key: "ped.linguagem_comunicacao", label: "Linguagem e comunicação", hint: "pediu, explicou e respondeu (fala, gesto ou figura)" },
      { key: "ped.resolucao_problemas", label: "Resolução de problemas e curiosidade", hint: "explorou, testou hipóteses, tentou de outro jeito" },
    ],
  },
];

/** Respostas: chave do item -> nível. Item ausente/undefined = não respondido. */
export type SessionReportAnswers = Partial<Record<string, SessionReportLevel>>;

const ALL_ITEMS: readonly SessionReportItem[] = SESSION_REPORT_CATALOG.flatMap((s) => s.items);

export function sessionReportItemCount(): number {
  return ALL_ITEMS.length;
}

export interface SessionReportProgress {
  answered: number;
  total: number;
  bySector: Record<EmployeeSector, { answered: number; total: number }>;
}

export function sessionReportProgress(answers: SessionReportAnswers): SessionReportProgress {
  const bySector = {} as SessionReportProgress["bySector"];
  let answered = 0;
  for (const s of SESSION_REPORT_CATALOG) {
    const n = s.items.filter((i) => answers[i.key] != null).length;
    bySector[s.sector] = { answered: n, total: s.items.length };
    answered += n;
  }
  return { answered, total: ALL_ITEMS.length, bySector };
}

export function sessionReportDeadlineMs(checkoutAtMs: number): number {
  return checkoutAtMs + SESSION_REPORT_DEADLINE_MS;
}

/** Atrasado = estritamente depois de 40 min (igual ao servidor: `now > checkout + 40min`). */
export function sessionReportIsLate(checkoutAtMs: number, nowMs: number): boolean {
  return nowMs > sessionReportDeadlineMs(checkoutAtMs);
}

export interface EligibleMinutesInput {
  planDurationMinutes: number | null;
  hourBankAllocatedMinutes: number | null;
  packageAllocatedMinutes: number | null;
  childCreditAllocatedMinutes: number | null;
}

/** Igual ao `greatest(...)` da RPC fa_session_reports_pending. */
export function sessionEligibleMinutes(s: EligibleMinutesInput): number {
  return Math.max(
    s.planDurationMinutes ?? 0,
    s.hourBankAllocatedMinutes ?? 0,
    s.packageAllocatedMinutes ?? 0,
    s.childCreditAllocatedMinutes ?? 0,
  );
}

export function isSessionReportEligible(minutes: number): boolean {
  return minutes >= SESSION_REPORT_MIN_MINUTES;
}

/** Agrupa os rótulos dos itens respondidos por nível — alimenta a mensagem de fallback e testes. */
export function summarizeAnswersForMessage(answers: SessionReportAnswers): Record<"autonomo" | "desenvolvendo" | "apoio", string[]> {
  const out = { autonomo: [] as string[], desenvolvendo: [] as string[], apoio: [] as string[] };
  for (const item of ALL_ITEMS) {
    const level = answers[item.key];
    if (level === "AUTONOMO") out.autonomo.push(item.label);
    else if (level === "DESENVOLVENDO") out.desenvolvendo.push(item.label);
    else if (level === "APOIO") out.apoio.push(item.label);
  }
  return out;
}
