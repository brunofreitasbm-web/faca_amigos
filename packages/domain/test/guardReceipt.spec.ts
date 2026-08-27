import { describe, expect, it } from "vitest";
import { generateEscPosReceipt } from "../src/printers/escpos.js";
import type { ReceiptPrintPayload } from "../src/printers/escpos.js";

const RECIBO_DE_GUARDA: ReceiptPrintPayload = {
  title: "Check-in",
  unitName: "Playground Parque Shopping",
  unitCnpj: "12.345.678/0001-90",
  employeeName: "Admin Dev",
  dateTime: "07/08/2026 15:30:00",
  accessCode: "K7M2P9QX3B7",
  qrValue: "K7M2P9QX3B7",
  entryTime: "15:30",
  expectedExitTime: "16:00",
  planName: "30 minutos",
  careNotes: "Usa Abafador | Sensivel a Ruido Alto",
  items: [{ description: "30 minutos", quantity: 1, amountCents: 4000 }],
  totalCents: 4000,
  customerInfo: {
    childName: "Helena Souza",
    childBirthDate: "12/03/2019",
    guardianName: "Maria Souza",
    guardianCpf: "123.456.789-00",
    phone: "+5591982501215",
  },
};

describe("recibo de guarda / Check-in (via dos pais, impressa no check-in)", () => {
  const { text } = generateEscPosReceipt(RECIBO_DE_GUARDA);
  const linhas = text.split("\n");

  it("destaca o codigo de saida, compacto e sem espaco em branco ao redor", () => {
    expect(text).toContain("Código de saída: K7M2-P9QX-3B7");
    expect(text).toContain("Apresente este recibo na saída");
  });

  it("identifica a crianca e quem a entregou, para valer como prova da guarda", () => {
    expect(text).toContain("Helena Souza - Resp: Maria Souza");
    // Nascimento + CPF juntos podem passar de 42 colunas — aqui quebram em duas linhas, mas sem perder dado nenhum.
    expect(text).toContain("Nascimento: 12/03/2019");
    expect(text).toContain("CPF:");
    expect(text).toContain("123.456.789-00");
  });

  it("imprime horario de entrada e saida prevista", () => {
    expect(text).toContain("Entrada: 15:30");
    expect(text).toContain("Saída prevista: 16:00");
  });

  it("repete os cuidados informados na entrada", () => {
    expect(text).toContain("CUIDADOS INFORMADOS PELO RESPONSÁVEL");
    expect(text).toContain("Usa Abafador");
  });

  it("nao diz TOTAL: no check-in nada foi pago ainda, e nao repete a tabela de itens", () => {
    expect(text).not.toContain("TOTAL:");
    expect(text).not.toContain("ITEM");
    expect(text).toContain("PREVISTO (pagar na saída)");
    expect(text).toContain("Tempo excedente é cobrado à parte.");
  });

  it("traz uma regra de retirada só, sem bloco de assinatura", () => {
    expect(text).toContain("RETIRADA");
    expect(text).toContain("documento com foto");
    expect(text).not.toContain("Assinatura do responsável");
    expect(text).not.toContain("__________");
  });

  it("respeita a largura de 42 colunas da bobina de 80mm", () => {
    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(42);
    }
  });

  it("termina com avanço de papel e corte automatico", () => {
    expect(text.startsWith("=")).toBe(true);
    expect(RECIBO_DE_GUARDA.qrValue).toBe(RECIBO_DE_GUARDA.accessCode);
    const { commandsHex } = generateEscPosReceipt(RECIBO_DE_GUARDA);
    expect(commandsHex.endsWith("1b64031d564200")).toBe(true);
  });

  it("oculta os termos de uso no recibo de guarda mesmo se footerNote vier preenchido com o texto dos termos", () => {
    const { text: textComTermos } = generateEscPosReceipt({
      ...RECIBO_DE_GUARDA,
      activity: "PLAYGROUND",
      footerNote: "TERMOS DE USO — FAÇA AMIGOS PLAYGROUND INCLUSIVO Ao aceitar este termo, o responsável legal confirma que leu...",
    });
    expect(textComTermos).not.toContain("TERMOS DE USO");
  });
});

describe("cupom de venda (sem accessCode) segue igual", () => {
  it("continua imprimindo TOTAL e nao imprime regras de retirada", () => {
    const { text } = generateEscPosReceipt({
      title: "Comprovante de Saída",
      unitName: "Playground Parque Shopping",
      code: "VD260807-00042",
      items: [{ description: "30 minutos", quantity: 1, amountCents: 4000 }],
      totalCents: 4000,
      payments: [{ method: "PIX", amountCents: 4000 }],
    });

    expect(text).toContain("Código: VD260807-00042");
    // Uma única forma de pagamento: TOTAL e forma saem numa linha só.
    expect(text).toContain("TOTAL (PIX):");
    expect(text).not.toContain("RETIRADA");
    expect(text).toContain("Obrigado por brincar com a gente!");
  });
});
