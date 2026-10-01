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
