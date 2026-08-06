import { describe, expect, it } from "vitest";
import { dateBrFromIso, formatDateBr, isValidDateBr, isoFromDateBr } from "../src/date.js";

describe("formatDateBr", () => {
  it("mascara progressivamente enquanto digita", () => {
    expect(formatDateBr("")).toBe("");
    expect(formatDateBr("3")).toBe("3");
    expect(formatDateBr("31")).toBe("31");
    expect(formatDateBr("311")).toBe("31/1");
    expect(formatDateBr("3112")).toBe("31/12");
    expect(formatDateBr("311220")).toBe("31/12/20");
    expect(formatDateBr("31122020")).toBe("31/12/2020");
  });

  it("ignora o que passar de 8 dígitos", () => {
    expect(formatDateBr("311220209999")).toBe("31/12/2020");
  });

  it("é idempotente sobre o próprio resultado (reformatar não quebra)", () => {
    expect(formatDateBr(formatDateBr("31122020"))).toBe("31/12/2020");
  });
});

describe("isValidDateBr", () => {
  it("aceita datas reais", () => {
    expect(isValidDateBr("31/12/2020")).toBe(true);
    expect(isValidDateBr("29/02/2024")).toBe(true); // bissexto
  });

  it("rejeita datas incompletas", () => {
    expect(isValidDateBr("")).toBe(false);
    expect(isValidDateBr("31/12")).toBe(false);
  });

  it("rejeita datas que não existem no calendário", () => {
    expect(isValidDateBr("31/02/2020")).toBe(false);
    expect(isValidDateBr("31/04/2020")).toBe(false);
    expect(isValidDateBr("29/02/2023")).toBe(false); // não bissexto
  });

  it("rejeita dia/mês/ano fora de faixa", () => {
    expect(isValidDateBr("00/12/2020")).toBe(false);
    expect(isValidDateBr("10/13/2020")).toBe(false);
    expect(isValidDateBr("10/12/1800")).toBe(false);
  });
});

describe("isoFromDateBr / dateBrFromIso", () => {
  it("converte BR -> ISO", () => {
    expect(isoFromDateBr("31/12/2020")).toBe("2020-12-31");
    expect(isoFromDateBr("05/03/2019")).toBe("2019-03-05");
  });

  it("devolve vazio quando a data é inválida ou incompleta", () => {
    expect(isoFromDateBr("31/02/2020")).toBe("");
    expect(isoFromDateBr("31/12")).toBe("");
  });

  it("converte ISO -> BR", () => {
    expect(dateBrFromIso("2020-12-31")).toBe("31/12/2020");
    expect(dateBrFromIso("")).toBe("");
  });

  it("faz a volta completa sem perder informação", () => {
    expect(isoFromDateBr(dateBrFromIso("2019-03-05"))).toBe("2019-03-05");
  });
});
