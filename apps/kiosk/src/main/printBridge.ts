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

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 2mm 3mm !important; background: #fff !important; width: 74mm; font-family: "Consolas", "Courier New", monospace; font-size: 11px; line-height: 1.25; font-weight: 600; text-rendering: geometricPrecision; color: #000 !important; }
      pre { font-family: inherit; font-size: inherit; white-space: pre; margin: 0; width: 100%; overflow: hidden; word-break: break-all; }
      .qr { display: flex; justify-content: center; margin: 2mm 0 3mm 0; }
      .qr svg { width: 34mm; height: 34mm; }
    </style></head><body>${qrBlock}<pre>${esc}</pre></body></html>`;
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

export function startPrintBridge(): void {
  const url = process.env.FACAAMIGOS_SUPABASE_URL;
  const serviceRoleKey = process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.warn(
      "[print-bridge] FACAAMIGOS_SUPABASE_URL / FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY não configurados neste terminal — " +
        "impressão de pulseira/cupom continua exigindo o diálogo do navegador no kiosk-ui.",
    );
    return;
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

  async function handleJob(job: PrintJobRow): Promise<void> {
    try {
      const deviceName = await printerNameFor(job.unit_id, job.kind);
      if (!deviceName) {
        throw new Error(`Nenhuma impressora de ${job.kind === "WRISTBAND" ? "pulseira" : "cupom"} configurada (Configurações > Impressoras)`);
      }

      if (job.kind === "WRISTBAND") {
        const tspl = generateGainschaGS2208DTSPL(job.payload_json as unknown as WristbandPrintPayload);
        const printedRaw = await printRawWindows(tspl, deviceName);
        if (!printedRaw) {
          const html = await wristbandHtml(job.payload_json as unknown as WristbandPayload);
          await printHtml(html, deviceName);
        }
      } else {
        const payload = job.payload_json as unknown as ReceiptPrintPayload;
        const escpos = generateEscPosReceipt(payload);
        const rawBuffer = Buffer.from(escpos.commandsHex, "hex");
        const printedRaw = await printRawWindows(rawBuffer, deviceName);
        if (!printedRaw) {
          const html = await receiptHtml(payload);
          await printHtml(html, deviceName);
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
      console.log(`[print-bridge] canal Realtime: ${status}`);
    });
}
