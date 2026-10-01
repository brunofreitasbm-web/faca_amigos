import { describe, expect, it } from "vitest";
import { averageScore, deltaPoints, npsBand, npsBandColor, npsValueColor, pct, summarizeNps } from "./nps.js";

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

describe("helpers do dashboard", () => {
  it("variação em pontos", () => {
    expect(deltaPoints(40, 25)).toBe(15);
    expect(deltaPoints(4.2, 4.5)).toBe(-0.3);
    expect(deltaPoints(null, 10)).toBeNull();
    expect(deltaPoints(10, null)).toBeNull();
  });

  it("percentual com base zero", () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(0, 0)).toBeNull();
  });

  it("cores por faixa e por zona do NPS", () => {
    expect(npsBandColor(10)).toBe("#10b981");
    expect(npsBandColor(8)).toBe("#f59e0b");
    expect(npsBandColor(3)).toBe("#ef4444");
    expect(npsValueColor(60)).toBe("#10b981");
    expect(npsValueColor(0)).toBe("#f59e0b");
    expect(npsValueColor(-10)).toBe("#ef4444");
    expect(npsValueColor(null)).toBe("#64748b");
  });
});
