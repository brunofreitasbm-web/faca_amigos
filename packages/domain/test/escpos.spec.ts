import { describe, expect, it } from "vitest";
import { generateEscPosReceipt, encodeCp860 } from "../src/printers/escpos.js";

describe("generateEscPosReceipt", () => {
  it("codifica caracteres em Português para a tabela CP860 (single-byte) sem corromper acentos", () => {
    // "FAÇA" -> F(0x46), A(0x41), Ç(0x80), A(0x41)
    const bytesFaca = encodeCp860("FAÇA");
    expect(bytesFaca).toEqual([0x46, 0x41, 0x80, 0x41]);

    // "Código" -> C(0x43), ó(0xa2), d(0x64), i(0x69), g(0x67), o(0x6f)
    const bytesCodigo = encodeCp860("Código");
    expect(bytesCodigo).toEqual([0x43, 0xa2, 0x64, 0x69, 0x67, 0x6f]);

    // "saída" -> s(0x73), a(0x61), í(0xa1), d(0x64), a(0x61)
    const bytesSaida = encodeCp860("saída");
    expect(bytesSaida).toEqual([0x73, 0x61, 0xa1, 0x64, 0x61]);

    // Ponto central (·) é substituído por traço (-) para evitar o glifo ™ na impressora
    const bytesPonto = encodeCp860("Ana · Resp");
    expect(String.fromCharCode(...bytesPonto)).toBe("Ana - Resp");
  });

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
    expect(receipt.text).toContain("Helena Souza - Resp: Maria Souza");
    expect(receipt.text).toContain("Plano 30 minutos");
    // Quantidade > 1 vai junto da descrição do item (sem coluna QTD própria).
    expect(receipt.text).toContain("Água mineral x2");
    // Uma forma de pagamento só: TOTAL e forma de pagamento saem numa linha.
    expect(receipt.text).toContain("TOTAL (PIX):                R$       50,00");
    expect(receipt.text).toContain("Comprovante interno, sem valor fiscal");

    // Verifica que cada linha de divisor tem exatamente 42 caracteres
    const lines = receipt.text.split("\n");
    const dividerLines = lines.filter((l) => l.startsWith("==="));
    expect(dividerLines.length).toBeGreaterThan(0);
    expect(dividerLines[0]!.length).toBe(42);

    // Verifica que o hex gerado possui o cabeçalho ESC @ + ESC t 3 (CP860) + ESC a 1 (Centralizado), avanço de 3 linhas (1b6403) e comando de corte de papel (1d564200)
    expect(receipt.commandsHex).toBeDefined();
    expect(receipt.commandsHex.startsWith("1b401b74031b6101")).toBe(true);
    expect(receipt.commandsHex.endsWith("1b64031d564200")).toBe(true);

    // Cupom sem accessCode não é recibo de guarda — sem trackingUrl, sem comando de QR.
    expect(receipt.commandsHex).not.toContain("1d286b");
  });

  it("imprime o QR de acompanhamento (GS ( k) no recibo de guarda quando trackingUrl é informado", () => {
    const receipt = generateEscPosReceipt({
      title: "Comprovante de Check-in",
      unitName: "Playground Parque Shopping",
      dateTime: "06/08/2026 15:30:00",
      items: [{ description: "Plano 2 horas", quantity: 1, amountCents: 6000 }],
      totalCents: 6000,
      accessCode: "K7QP3F2X9AB",
      exitPin: "4821",
      trackingUrl: "https://kiosk-ui.vercel.app/?acompanhar=K7QP3F2X9AB",
    });

    expect(receipt.text).toContain("ACOMPANHE PELO CELULAR");
    // URL de teste tem 44 colunas — maior que as 42 da bobina, por isso quebra
    // em duas linhas no texto; o dado do QR em si (abaixo) carrega a URL inteira.
    expect(receipt.text).toContain("kiosk-ui.vercel.app");

    // GS ( k = 1d 28 6b — comando padrão ESC/POS de QR Code embutido no meio do stream RAW.
    expect(receipt.commandsHex).toContain("1d286b");
    // A URL completa também precisa estar presente em bytes (dado armazenado do QR).
    const urlHex = Buffer.from("https://kiosk-ui.vercel.app/?acompanhar=K7QP3F2X9AB", "utf8").toString("hex");
    expect(receipt.commandsHex).toContain(urlHex);
    // Continua terminando com o mesmo avanço/corte de sempre, mesmo com o QR no meio.
    expect(receipt.commandsHex.endsWith("1b64031d564200")).toBe(true);
  });

  it("recibo de guarda (Check-in) sai compacto: sem bloco de assinatura, uma regra de retirada só", () => {
    const receipt = generateEscPosReceipt({
      title: "Check-in",
      unitName: "Playground Parque Shopping",
      dateTime: "06/08/2026 15:30:00",
      employeeName: "Ana Torres",
      items: [{ description: "Plano 2 horas", quantity: 1, amountCents: 6000 }],
      totalCents: 6000,
      accessCode: "K7QP3F2X9AB",
      exitPin: "4821",
      customerInfo: {
        childName: "Helena Souza",
        childBirthDate: "10/03/2019",
        guardianName: "Maria Souza",
        guardianCpf: "123.456.789-00",
      },
      planName: "Plano 2 horas",
      entryTime: "14:02",
      expectedExitTime: "16:02",
    });

    expect(receipt.text).toContain("*** CHECK-IN ***");
    // Código e PIN compactos, sem linhas em branco ao redor.
    expect(receipt.text).toContain("Código de saída: K7QP-3F2X-9AB");
    expect(receipt.text).toContain("PIN rápido (Saída): 4821");
    // Nome da criança e responsável numa linha; nascimento e CPF em outra.
    expect(receipt.text).toContain("Helena Souza - Resp: Maria Souza");
    // Nascimento + CPF juntos passam de 42 colunas — quebram em duas linhas, sem perder dado.
    expect(receipt.text).toContain("Nascimento: 10/03/2019");
    expect(receipt.text).toContain("123.456.789-00");
    // Só a regra essencial de retirada — sem a numeração de 4 regras antiga.
    expect(receipt.text).toContain("RETIRADA");
    expect(receipt.text).not.toContain("Não deixe a criança sem acompanhante");
    expect(receipt.text).not.toContain("retirada por terceiro");
    // Bloco de assinatura removido.
    expect(receipt.text).not.toContain("Assinatura do responsável");
    expect(receipt.text).not.toContain("__________");
    // Recibo de guarda não tem tabela ITEM/QTD/VALOR — o valor já está em PREVISTO.
    expect(receipt.text).not.toContain("ITEM");
    expect(receipt.text).toContain("PREVISTO (pagar na saída):  R$       60,00");
  });
});


