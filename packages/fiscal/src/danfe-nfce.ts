import QRCode from "qrcode";
import { formatarChaveAcessoEmGrupos } from "./chave-acesso.js";

/**
 * Layout do DANFE NFC-e simplificado para impressoras térmicas de 80mm —
 * mesmo formato de texto monoespaçado que `generateEscPosReceipt`
 * (packages/domain/src/printers/escpos.ts), renderizado num `<pre>` e
 * impresso via `window.print()` pelo print bridge (Fase 7 do plano).
 *
 * Este arquivo NÃO decide COMO o cupom é despachado — só monta o texto e,
 * à parte, a imagem do QR Code em data URL para quem for montar o HTML do
 * print job usar.
 */

export interface DanfeNfceItem {
  description: string;
  quantity: number;
  amountCents: number;
}

export interface DanfeNfcePayload {
  unitName: string;
  dateTime: string;
  items: DanfeNfceItem[];
  totalCents: number;
  payments: Array<{ method: string; amountCents: number }>;
  trocoCents: number;
  chaveAcesso: string;
  numero: number;
  serie: number;
  protocolo: string;
  /** URL de consulta específica do PA, com o QR Code já montado (ver qrcode-nfce.ts). */
  qrCodeUrl: string;
  /** null = consumidor não identificado, o caso comum na NFC-e. */
  consumidorCpf: string | null;
  /** true quando a nota foi emitida em contingência offline (sem rede no momento da venda). */
  contingencia: boolean;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateDanfeNfce(payload: DanfeNfcePayload): { text: string } {
  const lines: string[] = [];

  lines.push("================================================");
  lines.push("               FAÇA AMIGOS                      ");
  lines.push(`           ${payload.unitName.toUpperCase()}`);
  lines.push("================================================");
  lines.push("           DANFE NFC-e — DOCUMENTO AUXILIAR      ");
  lines.push("        DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA   ");
  if (payload.contingencia) {
    lines.push("------------------------------------------------");
    lines.push("   EMITIDA EM CONTINGÊNCIA — PENDENTE DE          ");
    lines.push("   AUTORIZAÇÃO PELA SEFAZ                         ");
  }
  lines.push("------------------------------------------------");
  lines.push(`NFC-e nº ${payload.numero}  série ${payload.serie}`);
  lines.push(`Data/Hora: ${payload.dateTime}`);
  lines.push("------------------------------------------------");

  lines.push("ITEM                                QTD    VALOR");
  lines.push("------------------------------------------------");
  for (const item of payload.items) {
    const desc = item.description.padEnd(28, " ").slice(0, 28);
    const qty = String(item.quantity).padStart(4, " ");
    const val = formatMoney(item.amountCents).padStart(10, " ");
    lines.push(`${desc} ${qty} R$ ${val}`);
  }
  lines.push("------------------------------------------------");
  lines.push(`TOTAL:                                 R$ ${formatMoney(payload.totalCents).padStart(10, " ")}`);

  if (payload.payments.length > 0) {
    lines.push("------------------------------------------------");
    lines.push("FORMA DE PAGAMENTO:");
    for (const p of payload.payments) {
      lines.push(` - ${p.method.padEnd(20, " ")} R$ ${formatMoney(p.amountCents).padStart(10, " ")}`);
    }
  }
  if (payload.trocoCents > 0) {
    lines.push(`Troco:                                 R$ ${formatMoney(payload.trocoCents).padStart(10, " ")}`);
  }

  lines.push("------------------------------------------------");
  lines.push(
    payload.consumidorCpf ? `CONSUMIDOR CPF: ${payload.consumidorCpf}` : "CONSUMIDOR NÃO IDENTIFICADO",
  );
  lines.push("------------------------------------------------");
  lines.push("Consulte pela Chave de Acesso em:");
  lines.push(payload.qrCodeUrl);
  lines.push("");
  lines.push(formatarChaveAcessoEmGrupos(payload.chaveAcesso));
  lines.push("");
  lines.push(`Protocolo de autorização: ${payload.protocolo}`);
  lines.push("================================================");

  return { text: lines.join("\n") };
}

/** Imagem do QR Code em data URL (PNG base64), pronta para um `<img src>`. */
export async function gerarQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}
