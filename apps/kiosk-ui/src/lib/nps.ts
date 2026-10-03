export interface NpsSummary {
  /** NPS de -100 a +100 (% promotores − % detratores); null sem respostas. */
  nps: number | null;
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
}

export type NpsBand = "PROMOTER" | "PASSIVE" | "DETRACTOR";

export function npsBand(score: number): NpsBand {
  if (score >= 9) return "PROMOTER";
  if (score >= 7) return "PASSIVE";
  return "DETRACTOR";
}

/** NPS padrão: promotores 9-10, neutros 7-8, detratores 0-6. */
export function summarizeNps(scores: number[]): NpsSummary {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= 0 && s <= 10);
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of valid) {
    const band = npsBand(s);
    if (band === "PROMOTER") promoters++;
    else if (band === "PASSIVE") passives++;
    else detractors++;
  }
  const total = valid.length;
  return {
    nps: total === 0 ? null : Math.round(((promoters - detractors) / total) * 100),
    total,
    promoters,
    passives,
    detractors,
  };
}

export function averageScore(scores: number[]): number | null {
  return scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ---- Dashboard (fa_crm_nps_dashboard / fa_crm_nps_comments) ----

export interface NpsPeriodSummary {
  sent: number;
  unitAnswered: number;
  scored: number;
  teamAnswered: number;
  spaceAnswered: number;
  commented: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  avgScore: number | null;
  avgTeam: number | null;
  avgSpace: number | null;
}

export interface NpsDashboardData {
  bucket: "day" | "week";
  summary: NpsPeriodSummary;
  previous: NpsPeriodSummary;
  trend: { bucket: string; sent: number; scored: number; promoters: number; detractors: number; nps: number | null }[];
  byUnit: {
    unit_id: string | null;
    name: string;
    sent: number;
    scored: number;
    avg_team: number | null;
    avg_space: number | null;
    nps: number | null;
  }[];
  distribution: Record<"score" | "team" | "space", { value: number; count: number }[]>;
}

export interface NpsCommentRow {
  id: string;
  sent_at_ms: number;
  scored_at_ms: number | null;
  unit_id: string | null;
  unit_name: string | null;
  brand: string;
  score: number;
  score_team: number | null;
  score_space: number | null;
  feedback: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

/** Variação em pontos contra o período anterior; null se algum dos dois não tem dado. */
export function deltaPoints(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 100) / 100;
}

/** Percentual inteiro (a/b); null sem base. */
export function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Cor da nota 0-10 por faixa (detrator, neutro, promotor). */
export function npsBandColor(score: number): string {
  const band = npsBand(score);
  return band === "PROMOTER" ? "#10b981" : band === "PASSIVE" ? "#f59e0b" : "#ef4444";
}

/** Cor do NPS agregado: ≥50 excelente, ≥0 bom, <0 crítico (zonas clássicas do NPS). */
export function npsValueColor(nps: number | null): string {
  if (nps == null) return "#64748b";
  return nps >= 50 ? "#10b981" : nps >= 0 ? "#f59e0b" : "#ef4444";
}
