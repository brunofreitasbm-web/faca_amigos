import { describe, expect, it } from "vitest";
import { anoMesLocal, formatarDataFiscal, formatarDataHoraFiscal } from "../src/data-hora.js";

describe("formatarDataHoraFiscal / formatarDataFiscal / anoMesLocal", () => {
  it("recupera o relógio de parede original (America/Belem, UTC-03:00) a partir do instante com offset", () => {
    const d = new Date("2026-08-31T23:30:00-03:00");
    expect(formatarDataHoraFiscal(d)).toBe("2026-08-31T23:30:00-03:00");
    expect(anoMesLocal(d)).toEqual({ ano: 2026, mes: 8 });
    expect(formatarDataFiscal(d)).toBe("2026-08-31");
  });

  it("dá o mesmo resultado para o mesmo instante expresso em UTC com 'Z'", () => {
    const d = new Date("2026-09-01T02:30:00Z");
    expect(formatarDataHoraFiscal(d)).toBe("2026-08-31T23:30:00-03:00");
    expect(anoMesLocal(d)).toEqual({ ano: 2026, mes: 8 });
    expect(formatarDataFiscal(d)).toBe("2026-08-31");
  });

  it("nunca produz 'Z' nem milissegundos, e sempre bate com o padrão de offset numérico", () => {
    const d = new Date("2026-09-01T02:30:00Z");
    const saida = formatarDataHoraFiscal(d);
    expect(saida).not.toContain("Z");
    expect(saida).not.toContain(".");
    expect(saida).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});
