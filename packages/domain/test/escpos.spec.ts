import { describe, expect, it } from "vitest";
import { generateEscPosReceipt } from "../src/printers/escpos.js";

describe("generateEscPosReceipt", () => {
  it("gera cupom não fiscal formatado em 42 colunas para impressoras de 80mm (Apptech T271U, Elgin i8/i9, Bematech 4200TH)", () => {
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
    // 42 colunas exatas: rótulo à esquerda, valor encostado na borda da bobina.
    expect(receipt.text).toContain("TOTAL:                      R$       50,00");
    expect(receipt.text).toContain("Não possui valor fiscal");

    // Verifica que cada linha de divisor tem exatamente 42 caracteres
    const lines = receipt.text.split("\n");
    const dividerLines = lines.filter((l) => l.startsWith("==="));
    expect(dividerLines.length).toBeGreaterThan(0);
    expect(dividerLines[0]!.length).toBe(42);

    // Verifica que o hex gerado possui o cabeçalho ESC @, avanço de 3 linhas (1b6403) e comando de corte de papel (1d564200)
    expect(receipt.commandsHex).toBeDefined();
    expect(receipt.commandsHex.startsWith("1b401b6101")).toBe(true);
    expect(receipt.commandsHex.endsWith("1b64031d564200")).toBe(true);
  });
});

