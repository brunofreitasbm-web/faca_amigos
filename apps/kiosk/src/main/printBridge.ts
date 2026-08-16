import { BrowserWindow } from "electron";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { generateEscPosReceipt, generateGainschaGS2208DTSPL } from "@facaamigos/domain";
import type { ReceiptPrintPayload, WristbandPrintPayload } from "@facaamigos/domain";
import { printRawWindows } from "./rawPrint.js";

interface PrintJobRow {
  id: string;
  unit_id: string;
  kind: "WRISTBAND" | "RECEIPT";
  payload_json: Record<string, unknown>;
  status: string;
}

import QRCode from "qrcode";
import { getFriendlyWristbandCode } from "@facaamigos/domain";

interface WristbandPayload {
  wristbandCode: string;
  childName: string;
  guardianName: string;
  phone: string;
  planName?: string;
  notes?: string;
  entryTime?: string;
}

async function wristbandHtml(p: WristbandPayload): Promise<string> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const friendlyCode = getFriendlyWristbandCode(p.wristbandCode);
  let qrSvg = "";
  try {
    qrSvg = await QRCode.toString(p.wristbandCode, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  } catch (err) {
    console.error("[print-bridge] Erro ao gerar QR Code:", err);
  }

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 270mm 20mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
      .wb { width: 270mm; height: 20mm; padding: 1mm 4mm; box-sizing: border-box; display: flex; flex-direction: row;
            align-items: center; justify-content: space-between; background: #fff; color: #000; }
      .cell { border-right: 2px solid #141414; padding-right: 12px; }
      .qr-cell { border-right: 2px solid #141414; padding-right: 12px; display: flex; align-items: center; gap: 8px; }
      .qr-cell svg { width: 16mm; height: 16mm; }
      .name { font-size: 16px; font-weight: bold; color: #F0196B; display: block; }
      .code { font-size: 15px; font-weight: bold; letter-spacing: 1px; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; border: 1px solid #ccc; }
      .notes { font-size: 10px; color: #d9534f; font-weight: bold; }
    </style></head><body>
    <div class="wb">
      <div class="cell"><span class="name">FaçaAmigos</span><span style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Playground Inclusivo</span></div>
      <div class="qr-cell">
        ${qrSvg}
        <div style="text-align:center"><div class="code">#${esc(friendlyCode)}</div></div>
      </div>
      <div class="cell">
        <div style="font-size:11px;color:#666">Criança:</div>
        <div style="font-size:15px;font-weight:800">${esc(p.childName)}</div>
        <div style="font-size:11px;font-weight:600;color:#444">Resp: ${esc(p.guardianName)} (${esc(p.phone)})</div>
      </div>
      <div>
        <div style="font-size:11px"><strong>Entrada:</strong> ${esc(p.entryTime ?? "")} ${p.planName ? `| ${esc(p.planName)}` : ""}</div>
        ${p.notes ? `<div class="notes">⚠️ OBS: ${esc(p.notes)}</div>` : ""}
      </div>
    </div>
  </body></html>`;
}

async function receiptHtml(payload: ReceiptPrintPayload): Promise<string> {
  const { text } = generateEscPosReceipt(payload);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // O recibo de guarda leva QR: é a via que os pais apresentam na saída, e o
  // caminho normal do check-out é a câmera do celular lendo justamente este
  // código. Sem imagem, sobraria só digitar o código à mão.
  let qrBlock = "";
  if (payload.qrValue) {
    try {
      const qrSvg = await QRCode.toString(payload.qrValue, { type: "svg", margin: 0, errorCorrectionLevel: "Q" });
      qrBlock = `<div class="qr">${qrSvg}</div>`;
    } catch (err) {
      console.error("[print-bridge] Erro ao gerar QR Code do recibo:", err);
    }
  }

  // QR de acompanhamento — separado do QR de saída acima: este abre, no
  // celular dos pais, o painel de tempo em tempo real da criança (ver
  // AcompanharScreen); aquele é lido pelo operador na hora da retirada.
  let trackingQrBlock = "";
  if (payload.trackingUrl) {
    try {
      const trackingSvg = await QRCode.toString(payload.trackingUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      trackingQrBlock = `<div class="qr"><div class="qr-label">ACOMPANHE PELO CELULAR</div>${trackingSvg}</div>`;
    } catch (err) {
      console.error("[print-bridge] Erro ao gerar QR Code de acompanhamento:", err);
    }
  }

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 2mm 3mm !important; background: #fff !important; width: 74mm; font-family: "Consolas", "Courier New", monospace; font-size: 11px; line-height: 1.25; font-weight: 600; text-rendering: geometricPrecision; color: #000 !important; }
      pre { font-family: inherit; font-size: inherit; white-space: pre; margin: 0; width: 100%; overflow: hidden; word-break: break-all; }
      .qr { display: flex; flex-direction: column; align-items: center; margin: 2mm 0 3mm 0; }
      .qr svg { width: 34mm; height: 34mm; }
      .qr-label { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1mm; }
    </style></head><body>${qrBlock}${trackingQrBlock}<pre>${esc}</pre></body></html>`;
}

// Mesma URL pública usada pelo kiosk-ui em VITE_PUBLIC_APP_URL (ver
// EntradaScreen/ConnectDeviceModal) — precisa da própria variável aqui
// porque o processo main do Electron não enxerga env vars de build do Vite.
function trackingUrlFor(accessCode: string | undefined): string | undefined {
  const raw = process.env.FACAAMIGOS_PUBLIC_APP_URL;
  if (!raw || !accessCode) return undefined;
  // Aceita a variável preenchida sem esquema (ex.: "kiosk-ui.vercel.app") —
  // sem "https://" na frente, a câmera do celular lê a URL só como texto
  // solto, não como link clicável.
  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return `${base.replace(/\/$/, "")}/?acompanhar=${accessCode}`;
}

function printHtml(html: string, deviceName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => {
        win.webContents.print(
          { silent: true, deviceName, printBackground: true, margins: { marginType: "none" } },
          (success, failureReason) => {
            win.destroy();
            if (success) resolve();
            else reject(new Error(failureReason || "falha desconhecida ao imprimir"));
          },
        );
      })
      .catch((err) => {
        win.destroy();
        reject(err);
      });
  });
}

export interface PrintBridgeStartResult {
  started: boolean;
  reason?: string;
}

/**
 * Se isto retornar `started: false`, NENHUM job de fa_kiosk_print_jobs vai
 * ser processado neste terminal — os jobs ficam acumulando como PENDING
 * para sempre, sem nenhum aviso além deste retorno (foi assim que uma
 * falta de .env em produção virou "a impressora não funciona" sem erro
 * nenhum na tela). Quem chama isto deve avisar o operador visivelmente.
 */
export function startPrintBridge(): PrintBridgeStartResult {
  const url = process.env.FACAAMIGOS_SUPABASE_URL || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";
  const serviceRoleKey =
    process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2anZwZHpzZmpkcHlhYmJ6enVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDUwNjA2OSwiZXhwIjoyMTAwMDgyMDY5fQ.wuwMmQAX8ICxFrOltge1QSCf-O31J9FZ021--behJFM";

  if (!url || !serviceRoleKey) {
    const reason =
      "FACAAMIGOS_SUPABASE_URL / FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY não configurados — impressão automática de pulseira/cupom está desligada neste terminal.";
    console.warn(`[print-bridge] ${reason}`);
    return { started: false, reason };
  }

  // supabase-js/realtime-js precisa de um WebSocket explícito fora do
  // navegador (o processo main do Electron é Node puro).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, serviceRoleKey, { realtime: { transport: WebSocket as any } });

  async function printerNameFor(unitId: string, kind: PrintJobRow["kind"]): Promise<string | null> {
    const key = kind === "WRISTBAND" ? "printer_wristband" : "printer_receipt";
    const { data } = await supabase.from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId).eq("key", key).maybeSingle();
    return (data?.value as string | undefined) ?? null;
  }

function isVirtualOrPdfPrinter(deviceName: string): boolean {
  const lower = deviceName.toLowerCase();
  return lower.includes("pdf") || lower.includes("xps") || lower.includes("virtual") || lower.includes("fax") || lower.includes("onenote");
}

  async function handleJob(job: PrintJobRow): Promise<void> {
    try {
      const deviceName = await printerNameFor(job.unit_id, job.kind);
      if (!deviceName) {
        throw new Error(`Nenhuma impressora de ${job.kind === "WRISTBAND" ? "pulseira" : "cupom"} configurada (Configurações > Impressoras)`);
      }

      const isVirtualOrPdf = isVirtualOrPdfPrinter(deviceName);

      if (job.kind === "WRISTBAND") {
        if (isVirtualOrPdf) {
          const html = await wristbandHtml(job.payload_json as unknown as WristbandPayload);
          await printHtml(html, deviceName);
        } else {
          const tspl = generateGainschaGS2208DTSPL(job.payload_json as unknown as WristbandPrintPayload);
          const printedRaw = await printRawWindows(tspl, deviceName);
          if (!printedRaw) {
            const html = await wristbandHtml(job.payload_json as unknown as WristbandPayload);
            await printHtml(html, deviceName);
          }
        }
      } else {
        const rawPayload = job.payload_json as unknown as ReceiptPrintPayload;
        const trackingUrl = trackingUrlFor(rawPayload.accessCode);
        const payload = trackingUrl ? { ...rawPayload, trackingUrl } : rawPayload;

        if (isVirtualOrPdf) {
          const html = await receiptHtml(payload);
          await printHtml(html, deviceName);
        } else {
          const escpos = generateEscPosReceipt(payload);
          const rawBuffer = Buffer.from(escpos.commandsHex, "hex");
          const printedRaw = await printRawWindows(rawBuffer, deviceName);
          if (!printedRaw) {
            const html = await receiptHtml(payload);
            await printHtml(html, deviceName);
          }
        }
      }

      await supabase.from("fa_kiosk_print_jobs").update({ status: "PRINTED", printed_at_ms: Date.now() }).eq("id", job.id);
      console.log(`[print-bridge] job ${job.id} (${job.kind}) impresso em "${deviceName}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("fa_kiosk_print_jobs").update({ status: "FAILED", error: message }).eq("id", job.id);
      console.error(`[print-bridge] job ${job.id} (${job.kind}) falhou: ${message}`);
    }
  }

  // Pega pedidos que chegaram antes deste terminal ligar (ex.: reiniciou
  // no meio do expediente) — a assinatura Realtime abaixo só pega INSERTs
  // futuros, não histórico.
  supabase
    .from("fa_kiosk_print_jobs")
    .select("id, unit_id, kind, payload_json, status")
    .eq("status", "PENDING")
    .then(({ data }) => {
      for (const job of (data ?? []) as PrintJobRow[]) void handleJob(job);
    });

  supabase
    .channel("fa_kiosk_print_jobs_bridge")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "fa_kiosk_print_jobs" }, (payload) => {
      void handleJob(payload.new as PrintJobRow);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(
          `[print-bridge] canal Realtime caiu (${status}) — jobs novos de impressão vão ficar PENDING até o terminal reiniciar.`,
        );
      } else {
        console.log(`[print-bridge] canal Realtime: ${status}`);
      }
    });

  return { started: true };
}
