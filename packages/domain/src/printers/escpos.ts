import { formatAccessCode } from "../utils/accessCode.js";

export interface ReceiptPrintPayload {
  title: string; // Ex: "COMPROVANTE DE CHECK-IN", "RECIBO DE GUARDA", "COMPROVANTE PDV"
  unitName: string;
  /** Dados cadastrais da unidade (endereço/telefone/CNPJ), geridos no backoffice. Opcionais — nem toda unidade tem tudo preenchido. */
  unitAddress?: string;
  unitPhone?: string;
  unitCnpj?: string;
  employeeName?: string;
  dateTime?: string;
  /** Código único da venda (fa_kiosk_orders.order_code), para auditoria/rastreamento. */
  code?: string;
  items: Array<{ description: string; quantity?: number; amountCents: number }>;
  totalCents: number;
  payments?: Array<{ method: string; amountCents: number }>;
  customerInfo?: {
    childName?: string;
    childBirthDate?: string;
    guardianName?: string;
    guardianCpf?: string;
    phone?: string;
  };
  footerNote?: string;

  // --- Recibo de guarda (via dos pais, impressa no check-in) -------------
  /** Código de acesso da criança. A presença deste campo é o que transforma o cupom em recibo de guarda. */
  accessCode?: string;
  /** PIN numérico de 4 dígitos para digitação rápida na Saída — alternativa ao QR/código longo. */
  exitPin?: string;
  /** Conteúdo do QR Code. Igual ao accessCode; separado porque só o caminho HTML do print bridge sabe desenhar imagem. */
  qrValue?: string;
  entryTime?: string;
  expectedExitTime?: string;
  planName?: string;
  /** Tags sensoriais e observações registradas na entrada. */
  careNotes?: string;
}

const WIDTH = 42;

function centerText(str: string, width = WIDTH): string {
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  return " ".repeat(left) + str;
}

/**
 * Linha de valor: rótulo à esquerda, `R$ 0.000,00` encostado na coluna 42.
 *
 * Era montada com espaços contados na mão, e a linha do TOTAL saía com 43
 * colunas — uma a mais que a bobina de 80mm comporta. Na impressora isso
 * não corta: dobra, e o valor da venda aparecia sozinho na linha de baixo.
 */
function moneyLine(label: string, cents: number): string {
  const value = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const right = `R$ ${value.padStart(11, " ")}`;
  return label.padEnd(Math.max(0, WIDTH - right.length), " ").slice(0, WIDTH - right.length) + right;
}

/** Quebra um texto longo em linhas de 42 colunas sem cortar palavra no meio. */
function wrap(str: string, width = WIDTH): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Gerador de comprovantes/cupons não fiscais para impressoras térmicas de 80mm
 * (Apptech T271U, Elgin i8/i9, Bematech MP-4200 TH, Epson TM-T20 / TM-T88, Daruma, etc.).
 * Formatado para 42 colunas (largura útil ideal de 72mm em bobina de 80mm).
 * Suporta emissão em formato texto limpo (driver de sistema / navegador) e comandos RAW ESC/POS.
 *
 * Duas variantes saem daqui:
 *   - cupom de venda (checkout, PDV) — itens, total e pagamento;
 *   - RECIBO DE GUARDA (`accessCode` preenchido) — a via que fica com os
 *     pais no check-in, com o código de saída, os dados de quem entregou a
 *     criança e as regras de retirada. Esse é o documento que o parque
 *     apresenta se a retirada for questionada, por isso ele imprime a
 *     identificação completa e uma linha de assinatura.
 */
export function generateEscPosReceipt(payload: ReceiptPrintPayload): { text: string; commandsHex: string } {
  const dateTime = payload.dateTime || new Date().toLocaleString("pt-BR");
  const isGuardReceipt = Boolean(payload.accessCode);
  const lines: string[] = [];

  const divider = "==========================================";
  const subDivider = "------------------------------------------";

  lines.push(divider);
  lines.push(centerText("FAÇA AMIGOS"));
  lines.push(centerText("PLAYGROUND INCLUSIVO"));
  lines.push(centerText(payload.unitName.toUpperCase()));
  if (payload.unitAddress) lines.push(centerText(payload.unitAddress));
  if (payload.unitPhone) lines.push(centerText(payload.unitPhone));
  if (payload.unitCnpj) lines.push(centerText(`CNPJ: ${payload.unitCnpj}`));
  lines.push(divider);
  lines.push(centerText(`*** ${payload.title.toUpperCase()} ***`));
  if (payload.code) lines.push(`Código: ${payload.code}`);
  lines.push(`Data/Hora: ${dateTime}`);
  if (payload.employeeName) lines.push(`Atendente: ${payload.employeeName}`);
  lines.push(subDivider);

  if (isGuardReceipt) {
    // O código de saída é a única informação desta via que alguém vai
    // procurar com pressa, na porta, com a criança chorando. Fica sozinho,
    // no topo, cercado de espaço em branco.
    lines.push("");
    lines.push(centerText("CÓDIGO DE SAÍDA"));
    lines.push(centerText(formatAccessCode(payload.accessCode)));
    if (payload.exitPin) {
      lines.push("");
      lines.push(centerText("PIN RÁPIDO (digite na Saída)"));
      lines.push(centerText(payload.exitPin));
    }
    lines.push("");
    lines.push(centerText("Apresente este recibo na saída"));
    lines.push(subDivider);
  }

  if (payload.customerInfo) {
    const c = payload.customerInfo;
    if (c.childName) lines.push(`Criança: ${c.childName}`);
    if (c.childBirthDate) lines.push(`Nascimento: ${c.childBirthDate}`);
    if (c.guardianName) lines.push(`Resp: ${c.guardianName}`);
    if (c.guardianCpf) lines.push(`CPF: ${c.guardianCpf}`);
    if (c.phone) lines.push(`Tel: ${c.phone}`);
    lines.push(subDivider);
  }

  if (isGuardReceipt) {
    if (payload.planName) lines.push(`Plano: ${payload.planName}`);
    if (payload.entryTime) lines.push(`Entrada: ${payload.entryTime}`);
    if (payload.expectedExitTime) lines.push(`Saída prevista: ${payload.expectedExitTime}`);
    lines.push(subDivider);

    if (payload.careNotes) {
      lines.push("CUIDADOS INFORMADOS PELO RESPONSÁVEL:");
      for (const line of wrap(payload.careNotes)) lines.push(line);
      lines.push(subDivider);
    }
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

  if (isGuardReceipt) {
    // No check-in nada foi cobrado ainda: o valor do plano é uma previsão, e
    // imprimir "TOTAL" aqui já fez pai achar que tinha pago na entrada.
    lines.push(moneyLine("PREVISTO (pagar na saída):", payload.totalCents));
    lines.push("Tempo excedente é cobrado à parte.");
  } else {
    lines.push(moneyLine("TOTAL:", payload.totalCents));
  }

  if (payload.payments && payload.payments.length > 0) {
    lines.push(subDivider);
    lines.push("PAGAMENTO:");
    for (const p of payload.payments) {
      const pVal = (p.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(` - ${p.method.padEnd(16, " ")} R$ ${pVal.padStart(11, " ")}`);
    }
  }

  if (isGuardReceipt) {
    lines.push(divider);
    lines.push(centerText("REGRAS DE RETIRADA"));
    lines.push(subDivider);
    for (const rule of [
      "1. A criança é entregue mediante leitura do QR Code deste recibo ou da pulseira.",
      "2. Na falta dos dois, a retirada é feita com documento com foto do responsável cadastrado acima, conferido pelo atendente.",
      "3. A retirada por terceiro é registrada como exceção, com identificação de quem retirou.",
      "4. Não deixe a criança sem acompanhante fora do espaço monitorado.",
    ]) {
      for (const line of wrap(rule)) lines.push(line);
    }
    lines.push("");
    lines.push("Assinatura do responsável:");
    lines.push("");
    lines.push("_".repeat(WIDTH));
  }

  lines.push(divider);
  if (payload.footerNote) {
    for (const line of wrap(payload.footerNote)) lines.push(centerText(line));
  } else if (!isGuardReceipt) {
    lines.push(centerText("Obrigado por brincar com a gente!"));
  }
  lines.push(centerText("Não possui valor fiscal — Comprovante Interno"));
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
