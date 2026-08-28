import { BrowserWindow } from "electron";
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { generateEscPosReceipt, generateEscPosCircuitoTermo, generateGainschaGS2208DTSPL } from "@facaamigos/domain";
import type { ReceiptPrintPayload, WristbandPrintPayload } from "@facaamigos/domain";
import { printRawWindows } from "./rawPrint.js";
import { listWindowsPrinters } from "./listPrinters.js";

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

  // O recibo de guarda exibe apenas o QR de acompanhamento pelo celular dos pais
  // (AcompanharScreen). O código de saída e o PIN para retirada no balcão
  // são mantidos no texto do recibo.
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
      html, body { margin: 0 !important; padding: 2mm 3mm !important; background: #fff !important; width: 74mm; font-family: "Consolas", "Courier New", monospace; font-size: 11px; line-height: 1.25; font-weight: 600; text-rendering: geometricPrecision; color: #000 !important; text-align: center; }
      pre { font-family: inherit; font-size: inherit; white-space: pre; margin: 0; width: 100%; overflow: hidden; word-break: break-all; text-align: center; }
      .qr { display: flex; flex-direction: column; align-items: center; margin: 2mm 0 3mm 0; }
      .qr svg { width: 34mm; height: 34mm; }
      .qr-label { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1mm; }
    </style></head><body>${trackingQrBlock}<pre>${esc}</pre></body></html>`;
}

async function circuitoTermoHtml(payload: ReceiptPrintPayload): Promise<string> {
  const { text } = generateEscPosCircuitoTermo(payload);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <style>
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 2mm 3mm !important; background: #fff !important; width: 74mm; font-family: "Consolas", "Courier New", monospace; font-size: 11px; line-height: 1.25; font-weight: 600; text-rendering: geometricPrecision; color: #000 !important; text-align: center; }
      pre { font-family: inherit; font-size: inherit; white-space: pre; margin: 0; width: 100%; overflow: hidden; word-break: break-all; text-align: center; }
    </style></head><body><pre>${esc}</pre></body></html>`;
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

function saveHtmlToPdfBuffer(html: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(async () => {
        try {
          const pdfBuffer = await win.webContents.printToPDF({
            printBackground: true,
            margins: { marginType: "none" },
          });
          win.destroy();
          resolve(pdfBuffer);
        } catch (err) {
          win.destroy();
          reject(err);
        }
      })
      .catch((err) => {
        win.destroy();
        reject(err);
      });
  });
}

/**
 * Limpa cupons em PDF armazenados na pasta local e no banco de dados
 * com tempo de vida superior a retentionDays (padrão: 10 dias).
 */
export async function cleanupExpiredPdfReceipts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any,
  retentionDays = 10,
): Promise<number> {
  let cleanedCount = 0;
  const now = Date.now();
  const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;
  const pdfDir = join(process.cwd(), "storage", "cupons_pdf");

  try {
    if (existsSync(pdfDir)) {
      const files = readdirSync(pdfDir);
      for (const file of files) {
        if (!file.endsWith(".pdf")) continue;
        const filePath = join(pdfDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < cutoffMs || stat.birthtimeMs < cutoffMs) {
            unlinkSync(filePath);
            cleanedCount++;
            console.log(`[print-bridge] PDF de cupom expirado removido do disco (${retentionDays} dias): ${file}`);
          }
        } catch (err) {
          console.warn(`[print-bridge] Erro ao excluir PDF expirado ${filePath}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[print-bridge] Erro na verificação de PDFs expirados:", err);
  }

  if (supabaseClient) {
    try {
      await supabaseClient.rpc("fa_kiosk_cleanup_expired_pdf_receipts", { days_retention: retentionDays });
    } catch {
      try {
        await supabaseClient.from("fa_kiosk_print_jobs").delete().eq("status", "SAVED_PDF").lt("created_at_ms", cutoffMs);
      } catch (e) {
        console.warn("[print-bridge] Erro ao limpar registros de PDF no Supabase:", e);
      }
    }
  }

  return cleanedCount;
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

  async function resolvePrinterDeviceName(unitId: string, kind: PrintJobRow["kind"]): Promise<string | null> {
    const configured = await printerNameFor(unitId, kind);
    const win = BrowserWindow.getAllWindows()[0];
    const installed = await listWindowsPrinters(() => (win ? win.webContents.getPrintersAsync() : Promise.resolve([])));
    const installedNames = installed.map((p) => p.name);

    if (configured && configured.trim()) {
      const trimmed = configured.trim();
      const exact = installedNames.find((n) => n === trimmed);
      if (exact) return exact;
      const caseIns = installedNames.find((n) => n.toLowerCase() === trimmed.toLowerCase());
      if (caseIns) return caseIns;
      const partial = installedNames.find(
        (n) => n.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(n.toLowerCase()),
      );
      if (partial) return partial;
    }

    const physical = installedNames.find((n) => !isVirtualOrPdfPrinter(n));
    if (physical) return physical;

    return configured || installedNames[0] || null;
  }

  async function handleReceiptPdfFallback(job: PrintJobRow, originalError: string): Promise<void> {
    const rawPayload = job.payload_json as unknown as ReceiptPrintPayload;
    const trackingUrl = trackingUrlFor(rawPayload.accessCode);
    const payload = trackingUrl ? { ...rawPayload, trackingUrl } : rawPayload;
    const html = await receiptHtml(payload);

    const pdfBuffer = await saveHtmlToPdfBuffer(html);
    const pdfDir = join(process.cwd(), "storage", "cupons_pdf");
    if (!existsSync(pdfDir)) {
      mkdirSync(pdfDir, { recursive: true });
    }

    const filename = `cupom_${job.id}_${Date.now()}.pdf`;
    const filePath = join(pdfDir, filename);
    writeFileSync(filePath, pdfBuffer);

    const base64Data = pdfBuffer.toString("base64");
    const pdfDataUrl = `data:application/pdf;base64,${base64Data}`;

    await supabase
      .from("fa_kiosk_print_jobs")
      .update({
        status: "SAVED_PDF",
        error: `Impressora ausente ou indisponível (${originalError}). Salvo em PDF (retenção 10 dias).`,
        pdf_path: filePath,
        pdf_url: pdfDataUrl,
        printed_at_ms: Date.now(),
      })
      .eq("id", job.id);

    console.log(`[print-bridge] job ${job.id} (RECEIPT) salvo em PDF devido a impressora ausente/com erro: ${filePath}`);
  }

  async function handleJob(job: PrintJobRow): Promise<void> {
    try {
      let deviceName: string | null = null;
      try {
        deviceName = await resolvePrinterDeviceName(job.unit_id, job.kind);
      } catch {
        deviceName = null;
      }

      if (!deviceName && job.kind === "RECEIPT") {
        await handleReceiptPdfFallback(job, "Nenhuma impressora de cupom configurada");
        return;
      }

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
        const isCircuito =
          Boolean(payload.accessCode) &&
          (payload.activity === "CARRINHO" ||
            /circuito/i.test(payload.unitName) ||
            Boolean(payload.assetName) ||
            payload.activity !== "PLAYGROUND");

        if (isVirtualOrPdf) {
          const html = await receiptHtml(payload);
          await printHtml(html, deviceName);
          if (isCircuito) {
            const termoHtml = await circuitoTermoHtml(payload);
            await printHtml(termoHtml, deviceName);
          }
        } else {
          const escpos = generateEscPosReceipt(payload);
          const rawBuffer = Buffer.from(escpos.commandsHex, "hex");
          const printedRaw = await printRawWindows(rawBuffer, deviceName);
          if (!printedRaw) {
            const html = await receiptHtml(payload);
            await printHtml(html, deviceName);
          }
          if (isCircuito) {
            const termoEscpos = generateEscPosCircuitoTermo(payload);
            const termoRawBuffer = Buffer.from(termoEscpos.commandsHex, "hex");
            const printedTermoRaw = await printRawWindows(termoRawBuffer, deviceName);
            if (!printedTermoRaw) {
              const termoHtml = await circuitoTermoHtml(payload);
              await printHtml(termoHtml, deviceName);
            }
          }
        }
      }

      await supabase.from("fa_kiosk_print_jobs").update({ status: "PRINTED", printed_at_ms: Date.now() }).eq("id", job.id);
      console.log(`[print-bridge] job ${job.id} (${job.kind}) impresso em "${deviceName}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.kind === "RECEIPT") {
        try {
          await handleReceiptPdfFallback(job, message);
          return;
        } catch (pdfErr) {
          console.error(`[print-bridge] Falha no fallback para PDF do job ${job.id}:`, pdfErr);
        }
      }
      await supabase.from("fa_kiosk_print_jobs").update({ status: "FAILED", error: message }).eq("id", job.id);
      console.error(`[print-bridge] job ${job.id} (${job.kind}) falhou: ${message}`);
    }
  }

  // Executa rotina de limpeza de cupons PDF com mais de 10 dias
  void cleanupExpiredPdfReceipts(supabase, 10);
  setInterval(() => {
    void cleanupExpiredPdfReceipts(supabase, 10);
  }, 12 * 60 * 60 * 1000);

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
