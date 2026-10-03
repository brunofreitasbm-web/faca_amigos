import { describe, expect, it } from "vitest";
import { isQuintaEmBelem, type OfertaInput, ofertaParaSessao, whatsappUrl } from "../src/screens/acompanhar/ofertaSite.js";

// 2026-10-01 (quinta) 15:00 em Belém = 18:00 UTC
const QUINTA = Date.UTC(2026, 9, 1, 18, 0, 0);
const SEXTA = Date.UTC(2026, 9, 2, 18, 0, 0);

const base: OfertaInput = {
  activity: "PLAYGROUND",
  isPausada: false,
  childFirstName: "Miguel",
  childVisitCount: 1,
  planDurationMinutes: 60,
  remainingMs: 10 * 60_000,
  nowMs: SEXTA,
};

describe("ofertaParaSessao", () => {
  it("só aparece nos últimos 15 minutos ou no excedente", () => {
    expect(ofertaParaSessao({ ...base, remainingMs: 16 * 60_000 })).toBeNull();
    expect(ofertaParaSessao({ ...base, remainingMs: 15 * 60_000 })?.kind).toBe("DEGRAU_2H");
    expect(ofertaParaSessao({ ...base, remainingMs: -5 * 60_000 })?.kind).toBe("DEGRAU_2H");
  });

  it("plano de até 1 hora leva o plano de 2 horas, mesmo para quem vem sempre", () => {
    expect(ofertaParaSessao({ ...base, planDurationMinutes: 30, childVisitCount: 9 })?.kind).toBe("DEGRAU_2H");
  });

  it("plano maior com 3+ visitas leva o Porto Seguro", () => {
    expect(ofertaParaSessao({ ...base, planDurationMinutes: 120, childVisitCount: 3 })?.kind).toBe("DEGRAU_PORTO");
  });

  it("Day Use só às quintas e com 2+ visitas", () => {
    const i = { ...base, planDurationMinutes: 120, childVisitCount: 2 };
    expect(ofertaParaSessao({ ...i, nowMs: QUINTA })?.kind).toBe("DEGRAU_DAYUSE");
    expect(ofertaParaSessao({ ...i, nowMs: SEXTA })).toBeNull();
    expect(ofertaParaSessao({ ...i, childVisitCount: 1, nowMs: QUINTA })).toBeNull();
  });

  it("nunca no Circuito nem em pausa", () => {
    expect(ofertaParaSessao({ ...base, activity: "CARRINHO" })).toBeNull();
    expect(ofertaParaSessao({ ...base, isPausada: true })).toBeNull();
  });
});

describe("whatsapp", () => {
  it("quinta em Belém independe do fuso do aparelho", () => {
    expect(isQuintaEmBelem(QUINTA)).toBe(true);
    expect(isQuintaEmBelem(SEXTA)).toBe(false);
    // 01:00 UTC de sexta ainda é quinta à noite em Belém
    expect(isQuintaEmBelem(Date.UTC(2026, 9, 2, 1, 0, 0))).toBe(true);
  });

  it("link com o texto codificado", () => {
    expect(whatsappUrl("Quero saber do Day Use")).toMatch(/^https:\/\/wa\.me\/\d+\?text=Quero%20saber%20do%20Day%20Use$/);
  });
});
