import { acompanharSessaoSchema } from "@facaamigos/contracts";
import { describe, expect, it } from "vitest";
import { olharUrl } from "../src/screens/acompanhar/olharSite.js";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG";

describe("olharUrl", () => {
  it("monta o link do session-report-view com o token", () => {
    expect(olharUrl(TOKEN)).toMatch(/\/functions\/v1\/session-report-view\?t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG$/);
  });

  it("rejeita token ausente ou fora do formato", () => {
    expect(olharUrl(null)).toBeNull();
    expect(olharUrl("")).toBeNull();
    expect(olharUrl("curto")).toBeNull();
    expect(olharUrl(`${TOKEN}?x=<script>`)).toBeNull();
  });
});

describe("sessão finalizada", () => {
  it("aceita com e sem token do Olhar", () => {
    const base = { status: "FINALIZADA", childFirstName: "Maria", checkoutAtMs: 1 };
    expect(acompanharSessaoSchema.parse({ ...base, reportToken: TOKEN })).toMatchObject({ reportToken: TOKEN });
    expect(acompanharSessaoSchema.parse(base)).toMatchObject({ reportToken: null });
    expect(acompanharSessaoSchema.parse({ ...base, reportToken: null })).toMatchObject({ reportToken: null });
  });
});
