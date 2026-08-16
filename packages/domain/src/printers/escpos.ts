import { formatAccessCode } from "../utils/accessCode.js";

export interface ReceiptPrintPayload {
  title: string; // Ex: "Check-in", "Comprovante de Saída", "Comprovante PDV"
  unitName: string;
  /**
   * Dados cadastrais da unidade (endereço/telefone/CNPJ). Aceitos mas não
   * impressos — o cupom já é "sem valor fiscal", então a via ficou só com
   * o nome da unidade; quem precisa do endereço/CNPJ completo pega por
   * outro canal. Mantidos no payload para não quebrar quem ainda os envia.
   */
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
  /**
   * Link do painel de acompanhamento (`/?acompanhar=<accessCode>`) que os pais
   * escaneiam com o próprio celular para ver o tempo da criança à distância.
   * Propositalmente separado de `qrValue`: aquele é o código cru lido pela
   * câmera do operador na Saída (fa_resolve_access_code) — imprimir a URL
   * completa ali quebraria a leitura, já que a normalização do código
   * (fa_kiosk_normalize_access_code) misturaria as letras do domínio com o
   * código. Por isso os dois QRs coexistem no mesmo recibo com finalidades
   * diferentes.
   */
  trackingUrl?: string;
  entryTime?: string;
  expectedExitTime?: string;
  planName?: string;
  /** Tags sensoriais e observações registradas na entrada. */
  careNotes?: string;
  activity?: string;
  assetName?: string;
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

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

function textToHex(str: string): string {
  return bytesToHex(Array.from(new TextEncoder().encode(str)));
}

/**
 * Comandos ESC/POS padrão (GS ( k, "2D barcode") para a impressora desenhar
 * o QR Code sozinha a partir dos dados crus — suportado nativamente pelas
 * térmicas de 80mm usadas aqui (Epson, Elgin, Bematech, Apptech, Daruma),
 * sem precisar gerar bitmap no app. É o que faz o QR sair mesmo no caminho
 * RAW (o mais comum — ver print bridge), que só manda bytes, nunca imagem.
 */
function qrCommandHex(data: string, moduleSize = 6): string {
  const dataBytes = Array.from(new TextEncoder().encode(data));
  const storeLen = dataBytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;

  const selectModel = [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00];
  const setModuleSize = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize];
  const setErrorCorrection = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]; // 'M'
  const storeData = [0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...dataBytes];
  const printQr = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30];

  return bytesToHex([...selectModel, ...setModuleSize, ...setErrorCorrection, ...storeData, ...printQr]);
}

/** Quebra uma string sem espaços (URL, código) em pedaços de até `width` colunas. */
function chunkString(str: string, width = WIDTH): string[] {
  const out: string[] = [];
  for (let i = 0; i < str.length; i += width) out.push(str.slice(i, i + width));
  return out;
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
 *   - recibo de guarda / Check-in (`accessCode` preenchido) — a via que
 *     fica com os pais no check-in, com o código de saída, os dados de
 *     quem entregou a criança e a regra de retirada.
 */
export function generateEscPosReceipt(payload: ReceiptPrintPayload): { text: string; commandsHex: string } {
  const dateTime = payload.dateTime || new Date().toLocaleString("pt-BR");
  const isGuardReceipt = Boolean(payload.accessCode);
  const lines: string[] = [];

  const divider = "==========================================";
  const subDivider = "------------------------------------------";

  lines.push(divider);
  lines.push(centerText("FAÇA AMIGOS"));
  lines.push(centerText(payload.unitName.toUpperCase()));
  lines.push(divider);
  lines.push(centerText(`*** ${payload.title.toUpperCase()} ***`));
  if (payload.code) lines.push(`Código: ${payload.code}`);
  lines.push(payload.employeeName ? `${dateTime} · ${payload.employeeName}` : dateTime);
  lines.push(subDivider);

  if (isGuardReceipt) {
    // Compacto de propósito: o código de saída precisa ser achado rápido,
    // mas sem página inteira de espaço em branco ao redor.
    lines.push(`Código de saída: ${formatAccessCode(payload.accessCode)}`);
    if (payload.exitPin) lines.push(`PIN rápido (Saída): ${payload.exitPin}`);
    lines.push("Apresente este recibo na saída");
    lines.push(subDivider);
  }

  // Marca onde entram os bytes crus do QR de acompanhamento no meio do
  // stream ESC/POS — text/lines seguem só como transcrição legível
  // (preview na tela e fallback HTML), o QR em si é comando de impressora.
  let qrInsertAt = -1;
  if (isGuardReceipt && payload.trackingUrl) {
    lines.push("");
    lines.push(centerText("ACOMPANHE PELO CELULAR"));
    lines.push(centerText("Aponte a câmera para o QR abaixo"));
    qrInsertAt = lines.length;
    for (const line of chunkString(payload.trackingUrl.replace(/^https?:\/\//, ""))) lines.push(centerText(line));
    lines.push("");
    lines.push(subDivider);
  }

  if (payload.customerInfo) {
    const c = payload.customerInfo;
    const nameLine = [c.childName, c.guardianName ? `Resp: ${c.guardianName}` : null].filter(Boolean).join(" · ");
    // wrap() em vez de push direto: nome+responsável ou nascimento+CPF podem
    // passar dos 42 caracteres da bobina — aqui a linha quebra em duas em vez
    // de estourar a largura física do papel.
    for (const line of wrap(nameLine)) lines.push(line);
    const idLine = [c.childBirthDate ? `Nascimento: ${c.childBirthDate}` : null, c.guardianCpf ? `CPF: ${c.guardianCpf}` : null]
      .filter(Boolean)
      .join(" · ");
    for (const line of wrap(idLine)) lines.push(line);
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

  // Recibo de guarda sempre tem 1 item (o plano) — o valor já aparece em
  // "PREVISTO" logo abaixo, então a tabela ficaria repetindo a mesma
  // informação 3 vezes. Só cupom de venda (checkout/PDV) mostra a tabela.
  if (!isGuardReceipt) {
    lines.push(`${"ITEM".padEnd(WIDTH - 5, " ")}VALOR`);
    lines.push(subDivider);
    for (const item of payload.items) {
      const qty = item.quantity ?? 1;
      const label = qty > 1 ? `${item.description} x${qty}` : item.description;
      lines.push(moneyLine(label, item.amountCents));
    }
    lines.push(subDivider);
  }

  const singlePayment =
    !isGuardReceipt && payload.payments && payload.payments.length === 1 && payload.payments[0]!.amountCents === payload.totalCents
      ? payload.payments[0]!
      : null;

  if (isGuardReceipt) {
    // No check-in nada foi cobrado ainda: o valor do plano é uma previsão, e
    // imprimir "TOTAL" aqui já fez pai achar que tinha pago na entrada.
    lines.push(moneyLine("PREVISTO (pagar na saída):", payload.totalCents));
    lines.push("Tempo excedente é cobrado à parte.");
  } else if (singlePayment) {
    lines.push(moneyLine(`TOTAL (${singlePayment.method}):`, payload.totalCents));
  } else {
    lines.push(moneyLine("TOTAL:", payload.totalCents));
  }

  if (!singlePayment && payload.payments && payload.payments.length > 0) {
    lines.push(subDivider);
    lines.push("PAGAMENTO:");
    for (const p of payload.payments) {
      const pVal = (p.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(` - ${p.method.padEnd(16, " ")} R$ ${pVal.padStart(11, " ")}`);
    }
  }

  if (isGuardReceipt) {
    lines.push(divider);
    lines.push(centerText("RETIRADA"));
    lines.push(subDivider);
    for (const line of wrap("Mediante leitura do QR (deste recibo ou da pulseira) ou documento com foto do responsável cadastrado.")) {
      lines.push(line);
    }
  }

  lines.push(divider);
  const isTermsFooter = Boolean(payload.footerNote && /termo/i.test(payload.footerNote));
  // Termos de Uso nunca são impressos no recibo de guarda (cupom de entrada)
  const showFooterNote = Boolean(
    payload.footerNote &&
      (!isGuardReceipt || !isTermsFooter) &&
      (!isTermsFooter || payload.activity === "CARRINHO")
  );
  if (showFooterNote && !isTermsFooter) {
    for (const line of wrap(payload.footerNote!)) lines.push(centerText(line));
  } else if (showFooterNote && isTermsFooter && payload.activity === "CARRINHO" && !isGuardReceipt) {
    for (const line of wrap(payload.footerNote!)) lines.push(centerText(line));
  } else if (!isGuardReceipt) {
    lines.push(centerText("Obrigado por brincar com a gente!"));
  }
  lines.push(centerText("Comprovante interno, sem valor fiscal"));
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

  // Quando há QR de acompanhamento, os bytes do comando de QR entram no meio
  // do stream, no lugar exato onde a URL apareceria como texto — o resto do
  // recibo (regras de retirada, itens, rodapé) segue normal depois dele.
  let hexBody: string;
  if (qrInsertAt >= 0 && payload.trackingUrl) {
    const before = lines.slice(0, qrInsertAt).join("\n") + "\n";
    const after = "\n" + lines.slice(qrInsertAt).join("\n");
    hexBody = textToHex(before) + qrCommandHex(payload.trackingUrl) + textToHex(after);
  } else {
    hexBody = textToHex(text);
  }

  return { text, commandsHex: hexHeader + hexBody + hexFeed + hexCut };
}

/**
 * Gerador do Termo de Responsabilidade e Uso exclusivo da Unidade Circuito.
 * Impresso em via separada retida no balcão para assinatura física do responsável.
 */
export function generateEscPosCircuitoTermo(payload: ReceiptPrintPayload): { text: string; commandsHex: string } {
  const dateTime = payload.dateTime || new Date().toLocaleString("pt-BR");
  const lines: string[] = [];

  const divider = "==========================================";
  const subDivider = "------------------------------------------";

  lines.push(divider);
  lines.push(centerText("FAÇA AMIGOS — CIRCUITO"));
  lines.push(centerText(payload.unitName.toUpperCase()));
  lines.push(divider);
  lines.push(centerText("*** TERMO DE RESPONSABILIDADE ***"));
  lines.push(centerText("(VIA RETIDA PELA UNIDADE)"));
  lines.push(subDivider);
  lines.push(`Data/Hora: ${dateTime}`);
  if (payload.accessCode) lines.push(`Código de Saída: ${formatAccessCode(payload.accessCode)}`);
  if (payload.customerInfo) {
    const c = payload.customerInfo;
    if (c.childName) lines.push(`Criança: ${c.childName}`);
    if (c.guardianName) lines.push(`Responsável: ${c.guardianName}`);
    if (c.guardianCpf) lines.push(`CPF Responsável: ${c.guardianCpf}`);
    if (c.phone) lines.push(`Telefone: ${c.phone}`);
  }
  if (payload.planName) lines.push(`Plano: ${payload.planName}`);
  if (payload.assetName) lines.push(`Veículo/Pelúcia: ${payload.assetName}`);
  lines.push(subDivider);
  lines.push("DECLARAÇÃO E REGRAS DE USO:");
  const declaracaoClausulas = [
    "1. Declaro ter recebido orientações sobre o uso correto e seguro dos miniveículos/pelúcias elétricas e assumo integral responsabilidade pela supervisão da criança durante toda a permanência no circuito.",
    "2. Declaro ser maior de idade e responsável legal pela criança acima identificada, e que quaisquer danos físicos causados por ela a terceiros (outras crianças, visitantes, funcionários) ou a mobiliário, estrutura e bens do shopping/estabelecimento durante o uso do circuito são de minha inteira e exclusiva responsabilidade, cabendo a mim o ressarcimento integral dos prejuízos.",
    "3. Reconheço que o Faça Amigos, seus sócios, funcionários e o shopping/estabelecimento onde a unidade está instalada ficam isentos de qualquer responsabilidade civil ou financeira por danos, acidentes ou prejuízos decorrentes do uso do equipamento pela criança, inclusive os causados a terceiros ou ao patrimônio do local.",
    "4. Estou ciente de que o descumprimento das orientações da equipe, o uso indevido do equipamento ou a ultrapassagem dos limites de peso/idade recomendados isentam integralmente o Faça Amigos de responsabilidade por quaisquer consequências.",
  ];
  for (const clausula of declaracaoClausulas) {
    for (const line of wrap(clausula)) lines.push(line);
    lines.push("");
  }
  lines.push(subDivider);
  lines.push("");
  lines.push("__________________________________________");
  lines.push(centerText("Assinatura do Responsável"));
  lines.push(divider);
  lines.push("");
  lines.push("");
  lines.push("");

  const text = lines.join("\n");
  const hexHeader = "1b401b6101"; // ESC @, ESC a 1
  const hexFeed = "1b6403"; // ESC d 3
  const hexCut = "1d564200"; // GS V 66 0

  return { text, commandsHex: hexHeader + textToHex(text) + hexFeed + hexCut };
}
