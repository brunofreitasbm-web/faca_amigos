import { describe, expect, it } from "vitest";
import { averageScore, npsBand, summarizeNps } from "./nps.js";

describe("summarizeNps", () => {
  it("classifica 9-10 promotor, 7-8 neutro, 0-6 detrator", () => {
    expect(npsBand(10)).toBe("PROMOTER");
    expect(npsBand(9)).toBe("PROMOTER");
    expect(npsBand(8)).toBe("PASSIVE");
    expect(npsBand(7)).toBe("PASSIVE");
    expect(npsBand(6)).toBe("DETRACTOR");
    expect(npsBand(0)).toBe("DETRACTOR");
  });

  it("calcula % promotores − % detratores", () => {
    const r = summarizeNps([10, 9, 8, 6]);
    expect(r).toEqual({ nps: 25, total: 4, promoters: 2, passives: 1, detractors: 1 });
  });

  it("devolve null sem respostas e ignora valores fora da faixa", () => {
    expect(summarizeNps([]).nps).toBeNull();
    expect(summarizeNps([11, -1, Number.NaN]).total).toBe(0);
  });
});

describe("averageScore", () => {
  it("média simples ou null", () => {
    expect(averageScore([4, 5])).toBe(4.5);
    expect(averageScore([])).toBeNull();
  });
});
