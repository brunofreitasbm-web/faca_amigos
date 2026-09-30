import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_SECTORS,
  SESSION_REPORT_CATALOG,
  isSessionReportEligible,
  sessionEligibleMinutes,
  sessionReportDeadlineMs,
  sessionReportIsLate,
  sessionReportItemCount,
  sessionReportProgress,
  summarizeAnswersForMessage,
} from "../src/session-report/catalog.js";

describe("catálogo do Olhar FaçaAmigos", () => {
  it("cobre os 4 setores com 3-4 itens cada", () => {
    expect(SESSION_REPORT_CATALOG.map((s) => s.sector)).toEqual([...EMPLOYEE_SECTORS]);
    for (const s of SESSION_REPORT_CATALOG) expect(s.items.length).toBeGreaterThanOrEqual(3);
    expect(sessionReportItemCount()).toBe(16);
  });

  it("chaves únicas e prefixadas pelo setor", () => {
    const prefix = { EDUCACAO_FISICA: "ef.", PSICOLOGIA: "psi.", TERAPIA_OCUPACIONAL: "to.", PEDAGOGIA: "ped." } as const;
    const keys = SESSION_REPORT_CATALOG.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SESSION_REPORT_CATALOG) for (const i of s.items) expect(i.key.startsWith(prefix[s.sector])).toBe(true);
  });

  it("a cópia usada pelas edge functions (Deno) é idêntica à do domain", () => {
    const a = readFileSync(new URL("../src/session-report/catalog.ts", import.meta.url), "utf8");
    const b = readFileSync(new URL("../../../supabase/functions/_shared/sessionReportCatalog.ts", import.meta.url), "utf8");
    expect(b).toBe(a);
  });
});

describe("progresso e resumo", () => {
  it("conta respondidos por setor e ignora não respondidos", () => {
    const p = sessionReportProgress({ "ef.equilibrio": "AUTONOMO", "psi.interacao_social": "APOIO" });
    expect(p.answered).toBe(2);
    expect(p.total).toBe(16);
    expect(p.bySector.EDUCACAO_FISICA).toEqual({ answered: 1, total: 4 });
    expect(p.bySector.PEDAGOGIA.answered).toBe(0);
  });

  it("agrupa rótulos por nível", () => {
    const s = summarizeAnswersForMessage({ "ef.equilibrio": "AUTONOMO", "to.transicoes": "DESENVOLVENDO", "ped.atencao_foco": "APOIO" });
    expect(s.autonomo).toEqual(["Manter o equilíbrio"]);
    expect(s.desenvolvendo).toEqual(["Trocar de brinquedo ou espaço com tranquilidade"]);
    expect(s.apoio).toEqual(["Ficar na atividade até o fim"]);
  });
});

describe("elegibilidade e prazo", () => {
  const none = { planDurationMinutes: null, hourBankAllocatedMinutes: null, packageAllocatedMinutes: null, childCreditAllocatedMinutes: null };

  it("plano de 2h é elegível; 30 min + banco de 90 é elegível; 45 min não", () => {
    expect(isSessionReportEligible(sessionEligibleMinutes({ ...none, planDurationMinutes: 120 }))).toBe(true);
    expect(isSessionReportEligible(sessionEligibleMinutes({ ...none, planDurationMinutes: 30, hourBankAllocatedMinutes: 90 }))).toBe(true);
    expect(isSessionReportEligible(sessionEligibleMinutes({ ...none, planDurationMinutes: 45 }))).toBe(false);
    expect(isSessionReportEligible(sessionEligibleMinutes(none))).toBe(false);
  });

  it("60 min exatos é elegível", () => {
    expect(isSessionReportEligible(60)).toBe(true);
    expect(isSessionReportEligible(59)).toBe(false);
  });

  it("atrasado só depois de 40 min do checkout", () => {
    const checkout = 1_000_000;
    expect(sessionReportDeadlineMs(checkout)).toBe(checkout + 2_400_000);
    expect(sessionReportIsLate(checkout, checkout + 2_399_000)).toBe(false);
    expect(sessionReportIsLate(checkout, checkout + 2_400_000)).toBe(false);
    expect(sessionReportIsLate(checkout, checkout + 2_401_000)).toBe(true);
  });
});
