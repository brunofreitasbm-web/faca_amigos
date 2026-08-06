export interface ReceiptPrintPayload {
  title: string; // Ex: "COMPROVANTE DE CHECK-IN", "RECIBO DE CAIXA", "COMPROVANTE PDV"
  unitName: string;
  employeeName?: string;
  dateTime?: string;
  items: Array<{ description: string; quantity?: number; amountCents: number }>;
  totalCents: number;
  payments?: Array<{ method: string; amountCents: number }>;
  customerInfo?: { childName?: string; guardianName?: string; phone?: string };
  footerNote?: string;
}

/**
 * Gerador de comprovantes/cupons não fiscais para impressoras térmicas de 80mm
 * (Elgin i8, Elgin i9, Bematech MP-4200 TH, Epson TM-T20 / TM-T88, Daruma, etc.).
 * Suporta emissão em formato texto limpo (driver de sistema / navegador) e comandos RAW ESC/POS.
 */
export function generateEscPosReceipt(payload: ReceiptPrintPayload): { text: string; commandsHex: string } {
  const dateTime = payload.dateTime || new Date().toLocaleString("pt-BR");
  const lines: string[] = [];

  lines.push("================================================");
  lines.push("               FAÇA AMIGOS                      ");
  lines.push("           PLAYGROUND INCLUSIVO                 ");
  lines.push(`           ${payload.unitName.toUpperCase()}`);
  lines.push("================================================");
  lines.push(`*** ${payload.title.toUpperCase()} ***`);
  lines.push(`Data/Hora: ${dateTime}`);
  if (payload.employeeName) lines.push(`Atendente: ${payload.employeeName}`);
  lines.push("------------------------------------------------");

  if (payload.customerInfo) {
    if (payload.customerInfo.childName) lines.push(`Criança: ${payload.customerInfo.childName}`);
    if (payload.customerInfo.guardianName) lines.push(`Resp: ${payload.customerInfo.guardianName}`);
    if (payload.customerInfo.phone) lines.push(`Tel: ${payload.customerInfo.phone}`);
    lines.push("------------------------------------------------");
  }

  lines.push("ITEM                                QTD    VALOR");
  lines.push("------------------------------------------------");
  for (const item of payload.items) {
    const desc = item.description.padEnd(28, " ").slice(0, 28);
    const qty = String(item.quantity ?? 1).padStart(4, " ");
    const val = (item.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(10, " ");
    lines.push(`${desc} ${qty} R$ ${val}`);
  }
  lines.push("------------------------------------------------");

  const totalStr = (payload.totalCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  lines.push(`TOTAL:                                 R$ ${totalStr.padStart(10, " ")}`);

  if (payload.payments && payload.payments.length > 0) {
    lines.push("------------------------------------------------");
    lines.push("PAGAMENTO:");
    for (const p of payload.payments) {
      const pVal = (p.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(` - ${p.method.padEnd(20, " ")} R$ ${pVal.padStart(10, " ")}`);
    }
  }

  lines.push("================================================");
  lines.push(payload.footerNote || "     Obrigado por brincar com a gente!          ");
  lines.push("  Não possui valor fiscal — Comprovante Interno ");
  lines.push("================================================");

  const text = lines.join("\n");

  // Bytes de inicialização ESC/POS (ESC @), alinhamento (ESC a 1) e acionamento de corte/guilhotina (GS V 66 0)
  const hexHeader = "1b401b6101"; // ESC @, ESC a 1
  const hexCut = "1d564200"; // GS V 66 0 (corte automático de papel)

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let hexText = "";
  for (let i = 0; i < bytes.length; i++) {
    hexText += bytes[i]!.toString(16).padStart(2, "0");
  }

  return { text, commandsHex: hexHeader + hexText + hexCut };
}
