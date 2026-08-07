export interface ReceiptPrintPayload {
  title: string; // Ex: "COMPROVANTE DE CHECK-IN", "RECIBO DE CAIXA", "COMPROVANTE PDV"
  unitName: string;
  employeeName?: string;
  dateTime?: string;
  /** Código único da venda (fa_kiosk_orders.order_code), para auditoria/rastreamento. */
  code?: string;
  items: Array<{ description: string; quantity?: number; amountCents: number }>;
  totalCents: number;
  payments?: Array<{ method: string; amountCents: number }>;
  customerInfo?: { childName?: string; guardianName?: string; phone?: string };
  footerNote?: string;
}

function centerText(str: string, width = 42): string {
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  return " ".repeat(left) + str;
}

/**
 * Gerador de comprovantes/cupons não fiscais para impressoras térmicas de 80mm
 * (Apptech T271U, Elgin i8/i9, Bematech MP-4200 TH, Epson TM-T20 / TM-T88, Daruma, etc.).
 * Formatado para 42 colunas (largura útil ideal de 72mm em bobina de 80mm).
 * Suporta emissão em formato texto limpo (driver de sistema / navegador) e comandos RAW ESC/POS.
 */
export function generateEscPosReceipt(payload: ReceiptPrintPayload): { text: string; commandsHex: string } {
  const dateTime = payload.dateTime || new Date().toLocaleString("pt-BR");
  const lines: string[] = [];

  const divider = "==========================================";
  const subDivider = "------------------------------------------";

  lines.push(divider);
  lines.push(centerText("FAÇA AMIGOS", 42));
  lines.push(centerText("PLAYGROUND INCLUSIVO", 42));
  lines.push(centerText(payload.unitName.toUpperCase(), 42));
  lines.push(divider);
  lines.push(centerText(`*** ${payload.title.toUpperCase()} ***`, 42));
  if (payload.code) lines.push(`Código: ${payload.code}`);
  lines.push(`Data/Hora: ${dateTime}`);
  if (payload.employeeName) lines.push(`Atendente: ${payload.employeeName}`);
  lines.push(subDivider);

  if (payload.customerInfo) {
    if (payload.customerInfo.childName) lines.push(`Criança: ${payload.customerInfo.childName}`);
    if (payload.customerInfo.guardianName) lines.push(`Resp: ${payload.customerInfo.guardianName}`);
    if (payload.customerInfo.phone) lines.push(`Tel: ${payload.customerInfo.phone}`);
    lines.push(subDivider);
  }

  // Layout 42 colunas: ITEM (22) + QTD (4) + VALOR R$ (14)
  lines.push("ITEM                    QTD        VALOR");
  lines.push(subDivider);
  for (const item of payload.items) {
    const desc = item.description.padEnd(22, " ").slice(0, 22);
    const qty = String(item.quantity ?? 1).padStart(4, " ");
    const val = (item.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(11, " ");
    lines.push(`${desc} ${qty} R$ ${val}`);
  }
  lines.push(subDivider);

  const totalStr = (payload.totalCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  lines.push(`TOTAL:                       R$ ${totalStr.padStart(11, " ")}`);

  if (payload.payments && payload.payments.length > 0) {
    lines.push(subDivider);
    lines.push("PAGAMENTO:");
    for (const p of payload.payments) {
      const pVal = (p.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(` - ${p.method.padEnd(16, " ")} R$ ${pVal.padStart(11, " ")}`);
    }
  }

  lines.push(divider);
  lines.push(centerText(payload.footerNote || "Obrigado por brincar com a gente!", 42));
  lines.push(centerText("Não possui valor fiscal — Comprovante Interno", 42));
  lines.push(divider);

  // Avanço de 3 linhas de papel para garantir que o corte da guilhotina não atinja o texto
  lines.push("");
  lines.push("");
  lines.push("");

  const text = lines.join("\n");

  // Bytes de inicialização ESC/POS (ESC @), alinhamento (ESC a 1), avanço de 3 linhas (ESC d 3) e corte automático (GS V 66 0)
  const hexHeader = "1b401b6101"; // ESC @, ESC a 1
  const hexFeed = "1b6403"; // ESC d 3 (avança 3 linhas de papel antes da guilhotina)
  const hexCut = "1d564200"; // GS V 66 0 (corte automático de papel)

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let hexText = "";
  for (let i = 0; i < bytes.length; i++) {
    hexText += bytes[i]!.toString(16).padStart(2, "0");
  }

  return { text, commandsHex: hexHeader + hexText + hexFeed + hexCut };
}

