import { describe, expect, it } from "vitest";
import { generateEscPosReceipt } from "../src/printers/escpos.js";

describe("generateEscPosReceipt", () => {
  it("gera cupom não fiscal formatado para impressoras de 80mm (Elgin i8/i9, Bematech 4200TH)", () => {
    const receipt = generateEscPosReceipt({
      title: "Recibo de Caixa",
      unitName: "Playground Parque Shopping",
      employeeName: "Admin Dev",
      dateTime: "06/08/2026 15:30:00",
      items: [
        { description: "Plano 30 minutos", quantity: 1, amountCents: 4000 },
        { description: "Água mineral", quantity: 2, amountCents: 1000 },
      ],
      totalCents: 5000,
      payments: [{ method: "PIX", amountCents: 5000 }],
      customerInfo: { childName: "Helena Souza", guardianName: "Maria Souza" },
    });

    expect(receipt.text).toContain("FAÇA AMIGOS");
    expect(receipt.text).toContain("*** RECIBO DE CAIXA ***");
    expect(receipt.text).toContain("Criança: Helena Souza");
    expect(receipt.text).toContain("Plano 30 minutos");
    expect(receipt.text).toContain("TOTAL:                                 R$      50,00");
    expect(receipt.text).toContain("Não possui valor fiscal");

    // Verifica que o hex gerado possui o cabeçalho ESC @ e o comando de corte de papel
    expect(receipt.commandsHex).toBeDefined();
    expect(receipt.commandsHex.startsWith("1b401b6101")).toBe(true);
    expect(receipt.commandsHex.endsWith("1d564200")).toBe(true);
  });
});
