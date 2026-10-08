import { describe, expect, it } from "vitest";
import { minutesUntilClosing } from "../src/time/closing-time.js";

// 2026-10-11 é domingo; 2026-10-10 é sábado (datas locais, como a função).
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("minutesUntilClosing", () => {
  it("formato antigo vale todos os dias", () => {
    expect(minutesUntilClosing(at(2026, 10, 10, 20), "22:10")).toBe(130);
    expect(minutesUntilClosing(at(2026, 10, 11, 20), "22:10")).toBe(130);
  });

  it("exceção de domingo só vale no domingo", () => {
    expect(minutesUntilClosing(at(2026, 10, 11, 20), "22:10;dom=21:10")).toBe(70);
    expect(minutesUntilClosing(at(2026, 10, 10, 20), "22:10;dom=21:10")).toBe(130);
  });

  it("valor inválido devolve null", () => {
    expect(minutesUntilClosing(at(2026, 10, 10, 20), "lixo")).toBeNull();
    expect(minutesUntilClosing(at(2026, 10, 10, 20), "25:00")).toBeNull();
    expect(minutesUntilClosing(at(2026, 10, 10, 20), ";dom=21:10")).toBeNull();
  });
});
