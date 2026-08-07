import { BrowserWindow } from "electron";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import QRCode from "qrcode";
import { generateEscPosReceipt } from "@facaamigos/domain";
import type { ReceiptPrintPayload } from "@facaamigos/domain";

/**
 * Fase 6 do plano, finalmente implementada: assina fa_kiosk_print_jobs
 * (Supabase Realtime) e manda o trabalho direto pra impressora do
 * sistema operacional via `webContents.print({ silent: true })` — sem
 * diálogo nenhum na tela do quiosque. `fa_kiosk_print_jobs` só aceita
 * UPDATE de `service_role` (RLS, migration 20260806000009), então este
 * processo precisa da service role key — configurada só aqui, neste
 * terminal, nunca no kiosk-ui (que roda com a anon key no navegador).
 */

interface PrintJobRow {
  id: string;
  unit_id: string;
  kind: "WRISTBAND" | "RECEIPT";
  payload_json: Record<string, unknown>;
  status: string;
}

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
  // wristband_code é um payload assinado (FA1|W|<id>|<hash>) — longo demais
  // pra caber como texto na etiqueta de 20mm, por isso vira QR code.
  const qrDataUrl = await QRCode.toDataURL(p.wristbandCode, { margin: 0, width: 160 });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 270mm 20mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
      .wb { width: 270mm; height: 20mm; padding: 1mm 4mm; box-sizing: border-box; display: flex; flex-direction: row;
            align-items: center; justify-content: space-between; background: #fff; color: #000; }
      .cell { border-right: 2px solid #141414; padding-right: 12px; }
      .name { font-size: 16px; font-weight: bold; color: #F0196B; display: block; }
      .qr { width: 56px; height: 56px; display: block; }
      .notes { font-size: 10px; color: #d9534f; font-weight: bold; }
    </style></head><body>
    <div class="wb">
      <div class="cell"><span class="name">FaçaAmigos</span><span style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Playground Inclusivo</span></div>
      <div class="cell" style="text-align:center;flex-shrink:0"><img class="qr" src="${qrDataUrl}" alt="Código da pulseira" /></div>
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

function receiptHtml(payload: ReceiptPrintPayload): string {
  const { text } = generateEscPosReceipt(payload);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0; padding: 4mm; background: #fff; }
      pre { font-family: "Courier New", monospace; font-size: 11px; white-space: pre-wrap; margin: 0; }
    </style></head><body><pre>${esc}</pre></body></html>`;
}

function printHtml(html: string, deviceName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => {
        win.webContents.print({ silent: true, deviceName, printBackground: true }, (success, failureReason) => {
          win.destroy();
          if (success) resolve();
          else reject(new Error(failureReason || "falha desconhecida ao imprimir"));
        });
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
      const html =
        job.kind === "WRISTBAND"
          ? await wristbandHtml(job.payload_json as unknown as WristbandPayload)
          : receiptHtml(job.payload_json as unknown as ReceiptPrintPayload);
      await printHtml(html, deviceName);
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
