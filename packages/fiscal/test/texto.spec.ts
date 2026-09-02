import { describe, expect, it } from "vitest";
import { sanitizarTextoFiscal, sanitizarTextoNfe } from "../src/texto.js";

describe("sanitizarTextoFiscal", () => {
  it("troca em-dash por hífen ASCII", () => {
    expect(sanitizarTextoFiscal("Parque Shopping — Belém")).toBe("Parque Shopping - Belém");
  });

  it("remove emoji e caracteres fora de Latin-1", () => {
    const entrada = "Pipoca doce 🍿 grande";
    const saida = sanitizarTextoFiscal(entrada);
    expect(saida).not.toMatch(/🍿/);
    expect(saida).toBe("Pipoca doce grande");
  });

  it("mantém acentos comuns (ç/é/ã) intactos após a normalização NFC", () => {
    expect(sanitizarTextoFiscal("Sessão de aniversário com pipoca não identificada")).toBe(
      "Sessão de aniversário com pipoca não identificada",
    );
    expect(sanitizarTextoFiscal("Função")).toBe("Função");
  });

  it("colapsa múltiplos espaços em um só", () => {
    expect(sanitizarTextoFiscal("Água   mineral    500ml")).toBe("Água mineral 500ml");
  });

  it("trunca para exatamente o tamanho máximo informado", () => {
    const entrada = "a".repeat(300);
    const saida = sanitizarTextoFiscal(entrada, 10);
    expect(saida).toHaveLength(10);
    expect(saida).toBe("a".repeat(10));
  });

  it("troca NBSP por espaço comum", () => {
    const nbsp = String.fromCharCode(160);
    const entrada = `Bairro${nbsp}Central`;
    expect(sanitizarTextoFiscal(entrada)).toBe("Bairro Central");
  });

  it("remove caracteres de controle (não vira espaço, some por completo)", () => {
    const tab = String.fromCharCode(9);
    const entrada = `Bairro${tab}Central`;
    expect(sanitizarTextoFiscal(entrada)).toBe("BairroCentral");
  });
});

describe("sanitizarTextoNfe", () => {
  it("aplica a mesma sanitização de sanitizarTextoFiscal", () => {
    expect(sanitizarTextoNfe("Refrigerante — lata")).toBe("Refrigerante - lata");
  });

  it("usa um default de tamanho máximo diferente de sanitizarTextoFiscal", () => {
    const entrada = "x".repeat(200);
    const nfe = sanitizarTextoNfe(entrada);
    const fiscal = sanitizarTextoFiscal(entrada);
    expect(nfe).toHaveLength(60);
    expect(fiscal).toHaveLength(200);
    expect(nfe.length).not.toBe(fiscal.length);
  });
});
