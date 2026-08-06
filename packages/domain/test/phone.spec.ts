import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "../src/phone.js";

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
