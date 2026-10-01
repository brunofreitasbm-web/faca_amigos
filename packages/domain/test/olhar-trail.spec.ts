import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OLHAR_TRAIL_CHART_NOTE,
  OLHAR_TRAIL_INTRO,
  buildOlharTrail,
  isOlharMilestone,
  nextOlharMilestone,
  olharEdition,
  spotlightSector,
  type OlharTrailHistoryItem,
} from "../src/session-report/trail.js";

const h = (id: string, answers: OlharTrailHistoryItem["answers"], minutes = 60): OlharTrailHistoryItem => ({
  id,
  filledAtMs: Number(id.replace(/\D/g, "")) * 1000,
  eligibleMinutes: minutes,
  answers,
});

describe("trilha de Olhares", () => {
  it("define o tipo pelo nº do Olhar", () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10, 11, 15, 20].map(olharEdition)).toEqual([
      "ESTREIA", "CONTINUIDADE", "MARCO", "CONTINUIDADE", "MARCO", "CONTINUIDADE", "CONTINUIDADE", "MARCO", "CONTINUIDADE", "MARCO", "MARCO",
    ]);
    expect(isOlharMilestone(7)).toBe(false);
    expect([1, 3, 5, 7, 10, 12].map(nextOlharMilestone)).toEqual([3, 5, 10, 10, 15, 15]);
  });

  it("novidades só positivas: 1ª vez e 1ª autonomia; nunca o que 'caiu'", () => {
    const hist = [
      h("r1", { "ef.equilibrio": "AUTONOMO", "psi.interacao_social": "AUTONOMO" }),
      h("r2", { "ef.equilibrio": "APOIO", "psi.interacao_social": "AUTONOMO", "to.transicoes": "APOIO", "ped.atencao_foco": "AUTONOMO" }),
    ];
    const t = buildOlharTrail(hist, "r2");
    expect(t.seq).toBe(2);
    expect(t.novidades.primeiraVez).toEqual(["Trocar de brinquedo ou espaço com tranquilidade", "Ficar na atividade até o fim"]);
    expect(t.novidades.primeiraAutonomia).toEqual([]);
    const t3 = buildOlharTrail([...hist, h("r3", { "to.transicoes": "AUTONOMO" })], "r3");
    expect(t3.novidades.primeiraAutonomia).toEqual(["Trocar de brinquedo ou espaço com tranquilidade"]);
  });

  it("1º Olhar não tem novidades", () => {
    const t = buildOlharTrail([h("r1", { "ef.equilibrio": "AUTONOMO" })], "r1");
    expect(t.edition).toBe("ESTREIA");
    expect(t.novidades).toEqual({ primeiraVez: [], primeiraAutonomia: [] });
    expect(t.spotlight).toBeNull();
  });

  it("conquistas por área só sobem e ignoram chaves antigas", () => {
    const hist = [
      h("r1", { "ef.equilibrio": "AUTONOMO", "velho.item": "AUTONOMO" }),
      h("r2", { "ef.equilibrio": "APOIO", "ef.coordenacao_ampla": "AUTONOMO" }),
      h("r3", { "psi.interacao_social": "AUTONOMO" }, 120),
    ];
    let prev = 0;
    for (const id of ["r1", "r2", "r3"]) {
      const t = buildOlharTrail(hist, id);
      const total = Object.values(t.conquistasPorArea).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
    const t = buildOlharTrail(hist, "r3");
    expect(t.conquistasPorArea.EDUCACAO_FISICA).toBe(2);
    expect(t.conquistasPorArea.PSICOLOGIA).toBe(1);
    expect(t.itensExplorados).toBe(3);
    expect(t.totalItens).toBe(16);
    expect(t.visitas).toHaveLength(3);
    expect(t.totalMinutos).toBe(240);
    expect(t.edition).toBe("MARCO");
  });

  it("área em destaque roda entre as respondidas", () => {
    const s = ["EDUCACAO_FISICA", "PEDAGOGIA"] as const;
    expect(spotlightSector(1, s)).toBeNull();
    expect(spotlightSector(2, s)).toBe("EDUCACAO_FISICA");
    expect(spotlightSector(3, s)).toBe("PEDAGOGIA");
    expect(spotlightSector(4, [])).toBeNull();
  });

  it("textos fixos não usam vocabulário clínico/avaliativo", () => {
    const bad = /evolu[cç][aã]o|desenvolvimento|laudo|terap|diagn[oó]stic|nota\b|pontua|desempenho\s+(?:da|de)/i;
    expect(OLHAR_TRAIL_INTRO).not.toMatch(bad);
    expect(OLHAR_TRAIL_CHART_NOTE).toMatch(/Não mede desempenho/);
    expect(OLHAR_TRAIL_CHART_NOTE).toMatch(/clínico/);
  });

  it("a cópia Deno é idêntica ao domain (exceto o import do catálogo)", () => {
    const a = readFileSync(new URL("../src/session-report/trail.ts", import.meta.url), "utf8");
    const b = readFileSync(new URL("../../../supabase/functions/_shared/sessionReportTrail.ts", import.meta.url), "utf8");
    expect(b).toBe(a.replace('"./catalog.js"', '"./sessionReportCatalog.ts"'));
  });
});
