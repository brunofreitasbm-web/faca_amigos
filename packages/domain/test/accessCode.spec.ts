import { describe, expect, it } from "vitest";
import {
  ACCESS_CODE_ALPHABET,
  formatAccessCode,
  looksLikeAccessCode,
  normalizeAccessCode,
} from "../src/utils/accessCode.js";
import { getFriendlyWristbandCode } from "../src/utils/wristbandCode.js";

const CODE = "K7M2P9QX3B7";

describe("normalizeAccessCode", () => {
  it("aceita o codigo como ele aparece impresso, com hifen", () => {
    expect(normalizeAccessCode("K7M2-P9QX-3B7")).toBe(CODE);
  });

  it("aceita minuscula, espaco e o # de exibicao", () => {
    expect(normalizeAccessCode(" #k7m2 p9qx 3b7 ")).toBe(CODE);
  });

  it("desfaz as confusoes de leitura do Crockford: I e L viram 1, O vira 0", () => {
    expect(normalizeAccessCode("I234567890A")).toBe("1234567890A");
    expect(normalizeAccessCode("L234567890A")).toBe("1234567890A");
    expect(normalizeAccessCode("O234567890A")).toBe("0234567890A");
  });

  it("nao remapeia U — ele nao existe no alfabeto e deve reprovar", () => {
    expect(normalizeAccessCode("U234567890A")).toBe("U234567890A");
    expect(looksLikeAccessCode("U234567890A")).toBe(false);
  });

  it("nao quebra com nulo ou indefinido", () => {
    expect(normalizeAccessCode(null)).toBe("");
    expect(normalizeAccessCode(undefined)).toBe("");
  });
});

describe("looksLikeAccessCode", () => {
  it("reconhece um codigo de 11 caracteres do alfabeto", () => {
    expect(looksLikeAccessCode(CODE)).toBe(true);
    expect(looksLikeAccessCode("k7m2-p9qx-3b7")).toBe(true);
  });

  it("rejeita tamanho errado, texto solto e o payload antigo da pulseira", () => {
    expect(looksLikeAccessCode("K7M2P9QX3B")).toBe(false);
    expect(looksLikeAccessCode("K7M2P9QX3B77")).toBe(false);
    expect(looksLikeAccessCode("")).toBe(false);
    expect(looksLikeAccessCode(`FA1|W|${"a".repeat(32)}|${"b".repeat(8)}`)).toBe(false);
  });

  it("todo caractere do alfabeto e aceito", () => {
    expect(ACCESS_CODE_ALPHABET).toHaveLength(32);
    for (const ch of ACCESS_CODE_ALPHABET) {
      expect(looksLikeAccessCode(ch.repeat(11))).toBe(true);
    }
  });
});

describe("formatAccessCode", () => {
  it("agrupa em 4-4-3 para o codigo poder ser ditado por telefone", () => {
    expect(formatAccessCode(CODE)).toBe("K7M2-P9QX-3B7");
    expect(formatAccessCode("k7m2p9qx3b7")).toBe("K7M2-P9QX-3B7");
  });

  it("formatar e depois normalizar volta ao original", () => {
    expect(normalizeAccessCode(formatAccessCode(CODE))).toBe(CODE);
  });

  it("devolve travessao quando nao ha codigo", () => {
    expect(formatAccessCode(null)).toBe("—");
  });
});

describe("getFriendlyWristbandCode", () => {
  it("mostra o codigo novo agrupado", () => {
    expect(getFriendlyWristbandCode(CODE)).toBe("K7M2-P9QX-3B7");
    expect(getFriendlyWristbandCode(`#${CODE}`)).toBe("K7M2-P9QX-3B7");
  });

  it("continua encurtando o payload antigo das pulseiras ja impressas", () => {
    expect(getFriendlyWristbandCode(`FA1|W|${"ab".repeat(16)}|${"c".repeat(8)}`)).toBe("ABABABAB");
  });

  it("nao quebra com codigo ausente", () => {
    expect(getFriendlyWristbandCode(null)).toBe("—");
  });
});
