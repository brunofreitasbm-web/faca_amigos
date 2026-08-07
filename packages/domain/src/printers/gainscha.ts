import { getFriendlyWristbandCode } from "../utils/wristbandCode.js";

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
 * Gerador de comandos RAW TSPL para impressora de pulseiras Gainscha GS-2208D (203 DPI).
 * Layout em modo PAISAGEM (270mm de largura x 20mm de altura de pulseira).
 */
export function generateGainschaGS2208DTSPL(data: WristbandPrintPayload): string {
  const nowStr = data.entryTime || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const cleanCode = data.wristbandCode.replace(/^#/, "");
  const friendlyCode = getFriendlyWristbandCode(data.wristbandCode);
  const childUpper = data.childName.toUpperCase();
  const guardianUpper = data.guardianName.toUpperCase();
  const planUpper = (data.planName || "").toUpperCase();

  const commands = [
    "SIZE 270 mm, 20 mm",
    "GAP 3 mm, 0",
    "DIRECTION 1,0",
    "CLS",
    "CODEPAGE 1252",
    // Seção 1: Marca do Parque
    'TEXT 30,30,"3",0,1,1,"FACA AMIGOS"',
    'TEXT 30,85,"2",0,1,1,"PLAYGROUND INCLUSIVO"',
    // Seção 2: QR Code imprimível e Número Amigável
    `QRCODE 420,5,M,3,A,0,"${cleanCode}"`,
    `TEXT 420,115,"2",0,1,1,"#${friendlyCode}"`,
    // Seção 3: Dados da Criança e Responsável
    `TEXT 900,25,"4",0,1,1,"CRIANCA: ${childUpper}"`,
    `TEXT 900,90,"2",0,1,1,"RESP: ${guardianUpper} (${data.phone})"`,
    // Seção 4: Horário e Plano
    `TEXT 1650,30,"3",0,1,1,"ENTRADA: ${nowStr}"`,
    `TEXT 1650,90,"2",0,1,1,"PLANO: ${planUpper || "PADRAO"}"`,
  ];

  if (data.notes) {
    commands.push(`TEXT 2100,30,"2",0,1,1,"OBS: ${data.notes.slice(0, 35).toUpperCase()}"`);
  }

  commands.push("PRINT 1,1", "");

  return commands.join("\r\n");
}
