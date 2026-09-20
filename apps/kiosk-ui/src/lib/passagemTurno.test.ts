import { describe, expect, it } from "vitest";
import {
  ACK_DELAY_MAX_MS,
  ACK_DELAY_MIN_MS,
  ackDelayFor,
  handoverSummary,
  normalizeHandover,
  validateHandover,
} from "./passagemTurno";

// Estes casos são o espelho exato da validação de fa_close_shift na
// migration 20260920100000. Se um deles mudar aqui, a migration muda junto
// — senão um fechamento enfileirado offline passa na tela e é recusado pelo
// servidor horas depois, quando ninguém mais está na loja para corrigir.

describe("validateHandover", () => {
  it("recusa campo vazio sem a declaração de sem alteração", () => {
    expect(validateHandover({ noChanges: false, conteudo: "" })).toEqual({ ok: false, reason: "VAZIO" });
  });

  it("trata texto só de espaços como vazio", () => {
    expect(validateHandover({ noChanges: false, conteudo: "    \n  " })).toEqual({ ok: false, reason: "VAZIO" });
  });

  it("recusa texto curto demais para ser um repasse de verdade", () => {
    expect(validateHandover({ noChanges: false, conteudo: "ok" })).toEqual({ ok: false, reason: "CURTO" });
    expect(validateHandover({ noChanges: false, conteudo: "." })).toEqual({ ok: false, reason: "CURTO" });
  });

  it("aceita texto a partir de 10 caracteres úteis", () => {
    expect(validateHandover({ noChanges: false, conteudo: "Escorregador quebrado" })).toEqual({ ok: true });
    expect(validateHandover({ noChanges: false, conteudo: "1234567890" })).toEqual({ ok: true });
  });

  it("aceita a declaração de sem alteração sozinha", () => {
    expect(validateHandover({ noChanges: true, conteudo: "" })).toEqual({ ok: true });
    expect(validateHandover({ noChanges: true, conteudo: "   " })).toEqual({ ok: true });
  });

  it("recusa sem alteração marcado junto com texto", () => {
    expect(validateHandover({ noChanges: true, conteudo: "Festa as 15h" })).toEqual({
      ok: false,
      reason: "CONTRADITORIO",
    });
  });
});

describe("normalizeHandover", () => {
  it("zera o texto quando o operador declarou sem alteração", () => {
    expect(normalizeHandover({ noChanges: true, conteudo: "rascunho esquecido" })).toEqual({
      noChanges: true,
      conteudo: "",
    });
  });

  it("apara o texto quando há conteúdo", () => {
    expect(normalizeHandover({ noChanges: false, conteudo: "  Piscina de bolinhas higienizada  " })).toEqual({
      noChanges: false,
      conteudo: "Piscina de bolinhas higienizada",
    });
  });
});

describe("ackDelayFor", () => {
  it("respeita o piso em textos curtos ou ausentes", () => {
    expect(ackDelayFor(null)).toBe(ACK_DELAY_MIN_MS);
    expect(ackDelayFor("")).toBe(ACK_DELAY_MIN_MS);
    expect(ackDelayFor("abc")).toBe(ACK_DELAY_MIN_MS + 3 * 35);
  });

  it("respeita o teto em textos longos", () => {
    expect(ackDelayFor("a".repeat(5000))).toBe(ACK_DELAY_MAX_MS);
  });
});

describe("handoverSummary", () => {
  it("mostra o selo quando não houve alteração", () => {
    expect(handoverSummary({ no_changes: true, conteudo: null })).toBe("Sem alteração");
  });

  it("colapsa espaços e trunca textos longos", () => {
    expect(handoverSummary({ no_changes: false, conteudo: "linha 1\n\nlinha 2" })).toBe("linha 1 linha 2");
    expect(handoverSummary({ no_changes: false, conteudo: "a".repeat(200) }, 10)).toBe(`${"a".repeat(9)}…`);
  });
});
