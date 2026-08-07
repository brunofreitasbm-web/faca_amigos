import { getFriendlyWristbandCode } from "../utils/wristbandCode.js";
import { looksLikeAccessCode, normalizeAccessCode } from "../utils/accessCode.js";

export interface WristbandPrintPayload {
  wristbandCode: string;
  childName: string;
  guardianName: string;
  phone: string;
  planName?: string;
  entryTime?: string;
  notes?: string;
}

/**
 * A pulseira é impressa em modo RAW: o texto vai direto para o firmware,
 * sem passar por um driver que faria a conversão de caracteres. Acento e
 * cedilha viram lixo na cabeça térmica, e aspas duplas fecham a string do
 * comando TSPL no meio — o que faz a impressora ignorar a etiqueta inteira
 * em silêncio. Por isso tudo que vem do cadastro passa por aqui antes.
 */
function tsplSafe(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim();
}

/** Nomes compostos longos estouram a zona da etiqueta e invadem a próxima. */
function fit(value: string, max: number): string {
  const clean = tsplSafe(value);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}.`;
}

/**
 * Comandos RAW TSPL para a impressora de pulseiras Gainscha GS-2208D
 * (203 DPI ≈ 8 pontos/mm; a etiqueta de 270mm x 20mm tem 2160 x 160 pontos).
 *
 * O QR carrega SÓ o código de acesso de 11 caracteres — nada de URL, prefixo
 * ou assinatura embutida. Com isso ele cabe na versão 1 do QR (21x21 módulos)
 * mesmo no nível Q de correção de erro, o que permite imprimir cada módulo
 * com 6 pontos: um QR grande, de baixa densidade, que a câmera do celular
 * engata de primeira e que sobrevive ao borrão típico da impressão térmica
 * e ao vinco da pulseira dobrada no pulso.
 *
 * O código e o nome da criança aparecem DUAS vezes ao longo da faixa, no
 * início e no fim: a pulseira dá a volta no pulso e nem sempre sobra a mesma
 * parte visível.
 */
export function generateGainschaGS2208DTSPL(data: WristbandPrintPayload): string {
  const nowStr = tsplSafe(
    data.entryTime || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  );
  const raw = data.wristbandCode.replace(/^#/, "").trim();
  // Códigos novos vão normalizados no QR (sem hífen, maiúsculo) para poderem
  // usar o modo alfanumérico compacto. Pulseiras antigas em reimpressão
  // mantêm o payload original, que é o que ainda casa no banco.
  const qrPayload = looksLikeAccessCode(raw) ? normalizeAccessCode(raw) : raw;
  const humanCode = tsplSafe(getFriendlyWristbandCode(raw));
  const childUpper = fit(data.childName.toUpperCase(), 26);
  const childShort = fit(data.childName.toUpperCase(), 18);
  const guardianUpper = fit(data.guardianName.toUpperCase(), 26);
  const planUpper = fit((data.planName || "PADRAO").toUpperCase(), 18);
  const phone = tsplSafe(data.phone);

  const commands = [
    "SIZE 270 mm, 20 mm",
    "GAP 3 mm, 0",
    "DIRECTION 1,0",
    "CLS",
    "CODEPAGE 1252",

    // Zona 1 (0–320) — marca e horário de entrada
    'TEXT 20,18,"3",0,1,1,"FACA AMIGOS"',
    'TEXT 20,54,"2",0,1,1,"PLAYGROUND INCLUSIVO"',
    `TEXT 20,90,"2",0,1,1,"ENTRADA ${nowStr} | ${planUpper}"`,

    // Zona 2 (330–800) — QR de saída e o mesmo código em texto
    `QRCODE 330,16,Q,6,A,0,"${qrPayload}"`,
    `TEXT 480,36,"4",0,1,1,"${humanCode}"`,
    'TEXT 480,82,"2",0,1,1,"CODIGO DE SAIDA"',

    // Zona 3 (850–1650) — quem é a criança e quem responde por ela
    `TEXT 850,16,"4",0,1,1,"${childUpper}"`,
    `TEXT 850,58,"2",0,1,1,"RESP: ${guardianUpper}"`,
    `TEXT 850,88,"2",0,1,1,"TEL: ${phone}"`,
  ];

  // Cuidados inclusivos ficam na etiqueta de propósito: é a informação que
  // o monitor precisa ver no pulso da criança, longe do balcão e da tela.
  if (data.notes) {
    commands.push(`TEXT 850,118,"2",0,1,1,"! ${fit(data.notes.toUpperCase(), 40)}"`);
  }

  // Zona 4 (1700–2160) — repetição para a volta do pulso
  commands.push(
    `TEXT 1700,26,"3",0,1,1,"${childShort}"`,
    `TEXT 1700,66,"3",0,1,1,"${humanCode}"`,
    'TEXT 1700,104,"1",0,1,1,"NAO REMOVER ATE A SAIDA"',
    "PRINT 1,1",
    "",
  );

  return commands.join("\r\n");
}
