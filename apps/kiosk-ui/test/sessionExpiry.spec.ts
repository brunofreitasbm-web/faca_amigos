import { describe, expect, it } from "vitest";
import { isSessionExpired, lastCutoff } from "../src/lib/supabase/sessionExpiry.js";

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m, 0, 0);

describe("sessionExpiry", () => {
  it("antes das 23h30 o último corte é o de ontem", () => {
    expect(lastCutoff(at(12, 8))).toEqual(at(11, 23, 30));
    expect(lastCutoff(at(12, 23, 29))).toEqual(at(11, 23, 30));
  });

  it("a partir das 23h30 o último corte é o de hoje", () => {
    expect(lastCutoff(at(12, 23, 30))).toEqual(at(12, 23, 30));
    expect(lastCutoff(at(12, 23, 59))).toEqual(at(12, 23, 30));
  });

  it("login de ontem à tarde está vencido na manhã seguinte (terminal desligado às 23h30)", () => {
    expect(isSessionExpired(at(11, 15).getTime(), at(12, 9))).toBe(true);
  });

  it("login de hoje continua válido durante o dia", () => {
    expect(isSessionExpired(at(12, 9).getTime(), at(12, 21))).toBe(false);
  });

  it("login de hoje vence às 23h30", () => {
    expect(isSessionExpired(at(12, 9).getTime(), at(12, 23, 29))).toBe(false);
    expect(isSessionExpired(at(12, 9).getTime(), at(12, 23, 30))).toBe(true);
  });

  it("login feito depois das 23h30 (fechamento) vale até o corte do dia seguinte", () => {
    const login = at(11, 23, 45).getTime();
    expect(isSessionExpired(login, at(12, 10))).toBe(false);
    expect(isSessionExpired(login, at(12, 23, 30))).toBe(true);
  });

  it("sessão sem carimbo é tratada como vencida", () => {
    expect(isSessionExpired(null, at(12, 9))).toBe(true);
  });
});
