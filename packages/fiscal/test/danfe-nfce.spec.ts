import { describe, expect, it } from "vitest";
import { generateDanfeNfce, gerarQrCodeDataUrl } from "../src/danfe-nfce.js";

const CHAVE = "15260812345678000199650010000001441000344449";

describe("generateDanfeNfce", () => {
  const basePayload = {
    unitName: "Parque Shopping Belém",
    dateTime: "07/08/2026 14:30:00",
    items: [{ description: "Água mineral 500ml", quantity: 2, amountCents: 1000 }],
    totalCents: 1000,
    payments: [{ method: "PIX", amountCents: 1000 }],
    trocoCents: 0,
    chaveAcesso: CHAVE,
    numero: 144,
    serie: 1,
    protocolo: "915260000001234",
    qrCodeUrl: "https://www.sefa.pa.gov.br/nfce/qrcode?p=abc",
    consumidorCpf: null,
    contingencia: false,
  };

  it("mostra CONSUMIDOR NÃO IDENTIFICADO quando não há CPF", () => {
    const { text } = generateDanfeNfce(basePayload);
    expect(text).toContain("CONSUMIDOR NÃO IDENTIFICADO");
  });

  it("mostra o CPF quando informado", () => {
    const { text } = generateDanfeNfce({ ...basePayload, consumidorCpf: "12345678909" });
    expect(text).toContain("CONSUMIDOR CPF: 12345678909");
  });

  it("formata a chave de acesso em grupos de 4 dígitos", () => {
    const { text } = generateDanfeNfce(basePayload);
    expect(text).toContain("1526 0812 3456 7800 0199 6500 1000 0001 4410 0034 4449");
  });

  it("marca visivelmente a nota emitida em contingência", () => {
    const { text } = generateDanfeNfce({ ...basePayload, contingencia: true });
    expect(text).toContain("EMITIDA EM CONTINGÊNCIA");
  });

  it("não marca contingência quando emitida normalmente", () => {
    const { text } = generateDanfeNfce(basePayload);
    expect(text).not.toContain("CONTINGÊNCIA");
  });
});

describe("gerarQrCodeDataUrl", () => {
  it("gera uma imagem PNG em data URL", async () => {
    const dataUrl = await gerarQrCodeDataUrl("https://www.sefa.pa.gov.br/nfce/qrcode?p=abc");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
