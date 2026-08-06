import { describe, expect, it } from "vitest";
import { formatPhoneBr, isValidPhoneBr, normalizePhoneE164 } from "../src/phone.js";

describe("normalizePhoneE164", () => {
  it("normaliza telefones brasileiros de 10 ou 11 dígitos sem +55", () => {
    expect(normalizePhoneE164("91982501215")).toBe("+5591982501215");
    expect(normalizePhoneE164("9132000000")).toBe("+559132000000");
  });

  it("normaliza telefones com formatação (parênteses, espaços e traços)", () => {
    expect(normalizePhoneE164("(91) 98250-1215")).toBe("+5591982501215");
    expect(normalizePhoneE164("+55 (91) 98250-1215")).toBe("+5591982501215");
    expect(normalizePhoneE164("5591982501215")).toBe("+5591982501215");
  });

  it("mantém formato se já estiver em E.164 limpo", () => {
    expect(normalizePhoneE164("+5591982501215")).toBe("+5591982501215");
  });

  it("retorna o valor original para entradas inválidas ou vazias", () => {
    expect(normalizePhoneE164("")).toBe("");
    expect(normalizePhoneE164("123")).toBe("123");
  });
});

describe("isValidPhoneBr", () => {
  it("aceita celular com nono dígito", () => {
    expect(isValidPhoneBr("(91) 98250-1215")).toBe(true);
    expect(isValidPhoneBr("91982501215")).toBe(true);
    expect(isValidPhoneBr("+5591982501215")).toBe(true);
  });

  it("aceita telefone fixo de 8 dígitos", () => {
    expect(isValidPhoneBr("(91) 3200-0000")).toBe(true);
  });

  it("rejeita celular sem o nono dígito", () => {
    // 8 dígitos começando com 9 não é fixo nem celular válido pós-2016.
    expect(isValidPhoneBr("(91) 9825-1215")).toBe(false);
  });

  it("rejeita DDD inexistente", () => {
    expect(isValidPhoneBr("(20) 98250-1215")).toBe(false);
    expect(isValidPhoneBr("(00) 98250-1215")).toBe(false);
  });

  it("rejeita quantidade de dígitos fora de 10/11", () => {
    expect(isValidPhoneBr("")).toBe(false);
    expect(isValidPhoneBr("123")).toBe(false);
    expect(isValidPhoneBr("919825012159")).toBe(false);
  });
});

describe("formatPhoneBr", () => {
  it("mascara progressivamente enquanto digita", () => {
    expect(formatPhoneBr("")).toBe("");
    expect(formatPhoneBr("9")).toBe("(9");
    expect(formatPhoneBr("91")).toBe("(91");
    expect(formatPhoneBr("919")).toBe("(91) 9");
    expect(formatPhoneBr("9198250")).toBe("(91) 9825-0");
    expect(formatPhoneBr("91982501215")).toBe("(91) 98250-1215");
  });

  it("formata fixo com o traço depois de 4 dígitos", () => {
    expect(formatPhoneBr("9132000000")).toBe("(91) 3200-0000");
  });

  it("aceita um E.164 vindo do banco e descarta o +55", () => {
    expect(formatPhoneBr("+5591982501215")).toBe("(91) 98250-1215");
  });

  it("nunca passa de 11 dígitos", () => {
    expect(formatPhoneBr("919825012159999")).toBe("(91) 98250-1215");
  });
});
