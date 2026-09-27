import { describe, expect, it } from "vitest";
import { buildWhisperArgs, maskPiiInTranscript, parseWhisperJson, whisperTimeoutMs } from "../src/main/voiceWorkerPolicy.js";

describe("buildWhisperArgs", () => {
  it("monta os argumentos do whisper-cli com português, JSON de saída e supressão de não-fala", () => {
    const args = buildWhisperArgs({ modelPath: "m.bin", wavPath: "a.wav", outBase: "out", threads: 4 });
    expect(args).toEqual(["-m", "m.bin", "-f", "a.wav", "-l", "pt", "-oj", "-of", "out", "-t", "4", "-np", "-sns"]);
  });

  it("nunca manda thread count menor que 1", () => {
    const args = buildWhisperArgs({ modelPath: "m.bin", wavPath: "a.wav", outBase: "out", threads: -3 });
    expect(args[args.indexOf("-t") + 1]).toBe("1");
  });
});

describe("parseWhisperJson", () => {
  it("junta os segmentos num texto único", () => {
    const raw = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: " Oi, bom dia! " },
        { offsets: { from: 1000, to: 3000 }, text: "Queria saber sobre o plano de 60 minutos." },
      ],
    });
    const result = parseWhisperJson(raw);
    expect(result.text).toBe("Oi, bom dia! Queria saber sobre o plano de 60 minutos.");
    expect(result.segments).toHaveLength(2);
    expect(result.isEmpty).toBe(false);
  });

  it("marca como vazio quando sobra menos de 5 palavras", () => {
    const raw = JSON.stringify({ transcription: [{ offsets: { from: 0, to: 500 }, text: "Oi." }] });
    expect(parseWhisperJson(raw).isEmpty).toBe(true);
  });

  it("descarta o mesmo segmento repetido 3x ou mais (alucinação em silêncio)", () => {
    const raw = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 500 }, text: "legendas pela comunidade" },
        { offsets: { from: 500, to: 1000 }, text: "legendas pela comunidade" },
        { offsets: { from: 1000, to: 1500 }, text: "legendas pela comunidade" },
        { offsets: { from: 1500, to: 5000 }, text: "obrigado, até mais, tenha um ótimo dia" },
      ],
    });
    const result = parseWhisperJson(raw);
    // As duas primeiras repetições ficam (streak <= 2), a terceira some.
    expect(result.text).toBe("legendas pela comunidade legendas pela comunidade obrigado, até mais, tenha um ótimo dia");
  });

  it("devolve vazio para JSON inválido em vez de lançar", () => {
    expect(parseWhisperJson("não é json")).toEqual({ text: "", segments: [], isEmpty: true });
  });
});

describe("maskPiiInTranscript", () => {
  it("mascara CPF com e sem pontuação", () => {
    expect(maskPiiInTranscript("meu CPF é 123.456.789-00")).toBe("meu CPF é [CPF]");
    expect(maskPiiInTranscript("cpf 12345678900 aqui")).toBe("cpf [CPF] aqui");
  });

  it("mascara telefone com DDD (formatado)", () => {
    expect(maskPiiInTranscript("é (91) 97777-6666")).toBe("é [TELEFONE]");
  });

  it("um número de 11 dígitos sem pontuação é ambíguo e cai como CPF (ainda assim mascarado)", () => {
    expect(maskPiiInTranscript("me liga no 91977776666")).toBe("me liga no [CPF]");
  });

  it("não mexe em texto sem dado sensível", () => {
    expect(maskPiiInTranscript("quero o plano de 60 minutos")).toBe("quero o plano de 60 minutos");
  });
});

describe("whisperTimeoutMs", () => {
  it("tem piso de 60s para áudios curtos", () => {
    expect(whisperTimeoutMs(5_000)).toBe(60_000);
  });

  it("escala com 3x a duração para áudios longos", () => {
    expect(whisperTimeoutMs(200_000)).toBe(600_000);
  });
});
