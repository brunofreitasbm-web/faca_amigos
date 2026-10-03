import { describe, expect, it } from "vitest";
import { opcoesDeRenovacao, type RenovarInput } from "../src/screens/acompanhar/renovarSite.js";

const base: RenovarInput = { activity: "PLAYGROUND", isPausada: false, childFirstName: "Maria", remainingMs: 5 * 60_000 };

describe("opcoesDeRenovacao", () => {
  it("oferece +30 e +60 min com o pedido escrito para o WhatsApp", () => {
    const o = opcoesDeRenovacao(base);
    expect(o?.map((x) => [x.minutes, x.cents])).toEqual([[30, 4800], [60, 9600]]);
    expect(decodeURIComponent(o![0].whatsappUrl.split("text=")[1])).toBe("Quero renovar +30 min da Maria");
  });

  it("só nos últimos 15 minutos ou no excedente", () => {
    expect(opcoesDeRenovacao({ ...base, remainingMs: 16 * 60_000 })).toBeNull();
    expect(opcoesDeRenovacao({ ...base, remainingMs: 15 * 60_000 })).not.toBeNull();
    expect(opcoesDeRenovacao({ ...base, remainingMs: -3 * 60_000 })).not.toBeNull();
  });

  it("nunca no Circuito nem em pausa", () => {
    expect(opcoesDeRenovacao({ ...base, activity: "CARRINHO" })).toBeNull();
    expect(opcoesDeRenovacao({ ...base, isPausada: true })).toBeNull();
  });
});
