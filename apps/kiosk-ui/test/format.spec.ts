import { describe, expect, it } from "vitest";
import { formatElapsed, money } from "../src/format.js";

describe("money", () => {
  it("formata centavos como BRL", () => {
    expect(money(3000)).toBe(money(3000)); // sanidade contra troca de locale
    expect(money(100)).toContain("1,00");
    expect(money(100)).toContain("R$");
  });
});

describe("formatElapsed", () => {
  it("formata mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });
});
