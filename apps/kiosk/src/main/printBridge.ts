import { BrowserWindow } from "electron";
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { Db } from "@facaamigos/db-local";
import { resolveTerminalSupabaseKey } from "../config/supabaseTerminalKey.js";
import { generateEscPosReceipt, generateEscPosCircuitoTermo, generateGainschaGS2208DTSPL } from "@facaamigos/domain";
import type { ReceiptPrintPayload, WristbandPrintPayload } from "@facaamigos/domain";
import { printRawWindows } from "./rawPrint.js";
import { listWindowsPrinters } from "./listPrinters.js";
import { onPrintBridgeRebind } from "./printBridgeControl.js";
import {
  getTerminalUnitIds,
  getLocalDeviceId,
  shouldConsiderJob,
  claimPrintJobs,
  claimPrintJob,
  releasePrintJob,
  isRetryableClaim,
  isVirtualOrPdfPrinter,
  resolvePrinterName,
  type PrintJobRow,
} from "./printJobPolicy.js";

export { getTerminalUnitIds, getLocalDeviceId };

/** Intervalo do sweep: também é o teto de atraso quando o Realtime cai. */
const SWEEP_INTERVAL_MS = 10_000;

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

  // DANFE NFC-e: mesmo padrão do QR de acompanhamento acima, mas para a
  // consulta pública da nota na SEFA-PA — usado só quando a impressão RAW
  // direta falhar e este fallback HTML entrar em ação (ver
  // handleReceiptPdfFallback mais abaixo).
  let fiscalQrBlock = "";
  if (payload.fiscalQrUrl) {
    try {
      const fiscalSvg = await QRCode.toString(payload.fiscalQrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      fiscalQrBlock = `<div class="qr"><div class="qr-label">CONSULTE A NFC-e</div>${fiscalSvg}</div>`;
    } catch (err) {
      console.error("[print-bridge] Erro ao gerar QR Code da NFC-e:", err);
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
    </style></head><body>${trackingQrBlock}<pre>${esc}</pre>${fiscalQrBlock}</body></html>`;
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
  /** false = terminal sem unidade amarrada; tem conserto na tela, sem reiniciar. */
  bound: boolean;
  reason?: string;
}

export interface PrintBridgeStatusInfo {
  started: boolean;
  bound: boolean;
  hasServiceRoleKey: boolean;
  reason?: string;
  lastError?: string | null;
  lastJobPrintedAtMs?: number | null;
}

let bridgeStatus: PrintBridgeStatusInfo = {
  started: false,
  bound: false,
  hasServiceRoleKey: false,
  reason: "Print bridge ainda não iniciado.",
  lastError: null,
  lastJobPrintedAtMs: null,
};

export function getPrintBridgeStatus(): PrintBridgeStatusInfo {
  return bridgeStatus;
}

/**
 * Se isto retornar `started: false`, NENHUM job de fa_kiosk_print_jobs vai
 * ser processado neste terminal — os jobs ficam acumulando como PENDING
 * para sempre, sem nenhum aviso além deste retorno. Quem chama isto deve avisar o operador visivelmente.
 */
export function startPrintBridge(db?: Db): PrintBridgeStartResult {
  const url = process.env.FACAAMIGOS_SUPABASE_URL || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";

  const { secretKey, hasServiceRoleKey } = resolveTerminalSupabaseKey();

  if (!url || !secretKey) {
    const reason =
      "A chave de acesso ao banco não está configurada neste terminal (FACAAMIGOS_SUPABASE_SECRET_KEY). " +
      "Ela precisa estar no arquivo .env da instalação — impressão automática de pulseira/cupom está desligada até lá.";
    console.warn(`[print-bridge] ${reason}`);
    bridgeStatus = { started: false, bound: getTerminalUnitIds(db).size > 0, hasServiceRoleKey, reason, lastError: reason };
    return bridgeStatus;
  }

  if (!hasServiceRoleKey) {
    const reason =
      "A chave de serviço (FACAAMIGOS_SUPABASE_SECRET_KEY) não está configurada corretamente no arquivo .env deste terminal " +
      "(está ausente, ou foi preenchida com a chave publicável sb_publishable_... por engano). A chave pública não possui permissão para reservar impressões.";
    console.warn(`[print-bridge] ${reason}`);
    bridgeStatus = { started: false, bound: getTerminalUnitIds(db).size > 0, hasServiceRoleKey: false, reason, lastError: reason };
    return bridgeStatus;
  }

  // supabase-js/realtime-js precisa de um WebSocket explícito fora do
  // navegador (o processo main do Electron é Node puro).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, secretKey, { realtime: { transport: WebSocket as any } });

  async function printerNameFor(unitId: string, kind: PrintJobRow["kind"]): Promise<string | null> {
    const key = kind === "WRISTBAND" ? "printer_wristband" : "printer_receipt";
    let configuredValue: string | null = null;

    try {
      const { data } = await supabase.from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId).eq("key", key).maybeSingle();
      if (data?.value) configuredValue = data.value as string;
    } catch (err) {
      console.warn(`[print-bridge] Erro ao consultar Supabase em fa_kiosk_app_settings (${key}):`, err);
    }

    if (!configuredValue && unitId !== unitId.toLowerCase()) {
      try {
        const { data } = await supabase.from("fa_kiosk_app_settings").select("value").eq("unit_id", unitId.toLowerCase()).eq("key", key).maybeSingle();
        if (data?.value) configuredValue = data.value as string;
      } catch {
        // ignore
      }
    }

    if (!configuredValue && db) {
      try {
        const row = db.prepare("SELECT value FROM app_settings WHERE key = ? ORDER BY updated_at_ms DESC").get(key) as { value: string } | undefined;
        if (row?.value?.trim()) configuredValue = row.value.trim();
      } catch {
        // ignore
      }
    }

    return configuredValue;
  }

  async function resolvePrinterDeviceName(unitId: string, kind: PrintJobRow["kind"]): Promise<string | null> {
    // Fail-closed: terminal sem unidade amarrada não resolve impressora
    // nenhuma. Antes a guarda era `size > 0 && !has(...)`, isto é, um
    // terminal não amarrado aceitava a impressora de qualquer unidade.
    const allowedUnits = getTerminalUnitIds(db);
    if (allowedUnits.size === 0 || !allowedUnits.has(unitId.toLowerCase())) {
      console.log(`[print-bridge] Recusando resolução de impressora: job da unidade ${unitId} não pertence a este terminal.`);
      return null;
    }

    const configured = await printerNameFor(unitId, kind);
    const win = BrowserWindow.getAllWindows()[0];
    const installed = await listWindowsPrinters(() => (win ? win.webContents.getPrintersAsync() : Promise.resolve([])));

    const match = resolvePrinterName(configured, installed.map((p) => p.name));
    if (match.warning) console.warn(`[print-bridge] ${match.warning}`);
    return match.name;
  }

  async function handleReceiptPdfFallback(job: PrintJobRow, originalError: string, deviceId: string | null): Promise<void> {
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
      .eq("id", job.id)
      .eq("claimed_by_device_id", deviceId);

    console.log(`[print-bridge] job ${job.id} (RECEIPT) salvo em PDF devido a impressora ausente/com erro: ${filePath}`);
  }

  /**
   * Imprime um job JÁ RESERVADO por este terminal. Quem reserva é o
   * Postgres (fa_kiosk_claim_print_job/_jobs): é a reserva, e não o
   * filtro em TypeScript, que garante que só um terminal imprime.
   */
  async function handleJob(job: PrintJobRow): Promise<void> {
    const deviceId = getLocalDeviceId(db);

    try {
      let deviceName: string | null = null;
      try {
        deviceName = await resolvePrinterDeviceName(job.unit_id, job.kind);
      } catch {
        deviceName = null;
      }

      if (!deviceName) {
        const reason = `Nenhuma impressora de ${job.kind === "WRISTBAND" ? "pulseira" : "cupom"} configurada (Configurações > Impressoras)`;

        // Este terminal está amarrado à unidade mas não resolveu a
        // impressora localmente (ex.: dois terminais na mesma unidade, só
        // um com a impressora instalada). Em vez de finalizar aqui (PDF ou
        // erro), devolve pra fila pro próximo sweep de QUALQUER terminal
        // amarrado à unidade tentar — inclusive um com a impressora certa.
        if (isRetryableClaim(job) && (await releasePrintJob(supabase, job.id, deviceId))) {
          console.warn(`[print-bridge] ${reason} — job ${job.id} devolvido pra fila para outro terminal tentar.`);
          return;
        }

        if (job.kind === "RECEIPT") {
          await handleReceiptPdfFallback(job, reason, deviceId);
          return;
        }

        throw new Error(reason);
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
          payload.activity !== "PLAYGROUND" &&
          (payload.activity === "CARRINHO" ||
            Boolean(payload.assetName) ||
            /circuito/i.test(payload.unitName));

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

      await supabase
        .from("fa_kiosk_print_jobs")
        .update({ status: "PRINTED", printed_at_ms: Date.now() })
        .eq("id", job.id)
        .eq("claimed_by_device_id", deviceId);
      console.log(`[print-bridge] job ${job.id} (${job.kind}) impresso em "${deviceName}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.kind === "RECEIPT") {
        try {
          await handleReceiptPdfFallback(job, message, deviceId);
          return;
        } catch (pdfErr) {
          console.error(`[print-bridge] Falha no fallback para PDF do job ${job.id}:`, pdfErr);
        }
      }
      await supabase
        .from("fa_kiosk_print_jobs")
        .update({ status: "FAILED", error: message })
        .eq("id", job.id)
        .eq("claimed_by_device_id", deviceId);
      console.error(`[print-bridge] job ${job.id} (${job.kind}) falhou: ${message}`);
    }
  }

  // Executa rotina de limpeza de cupons PDF com mais de 10 dias
  void cleanupExpiredPdfReceipts(supabase, 10);
  setInterval(() => {
    void cleanupExpiredPdfReceipts(supabase, 10);
  }, 12 * 60 * 60 * 1000);

  // -------------------------------------------------------------------
  // Entrega dos jobs
  // -------------------------------------------------------------------
  // O sweep periódico é o caminho PRINCIPAL, não o Realtime: uma queda do
  // canal passa a custar até SWEEP_INTERVAL_MS de atraso em vez de deixar
  // o job PENDING até alguém reiniciar o terminal (era o que o log
  // "canal Realtime caiu" avisava e ninguém conseguia evitar).
  //
  // Em ambos os caminhos quem decide é a reserva no Postgres: se a RPC não
  // devolver o job, outro terminal já é o dono e este não imprime.

  let channels: RealtimeChannel[] = [];
  // null (e não "") como estado inicial: um terminal ainda não amarrado
  // tem lista vazia, e "" == "" faria a primeira sincronização sair sem
  // nem avisar que nada será impresso aqui.
  let subscribedUnits: string | null = null;
  let sweeping = false;

  function currentUnitIds(): string[] {
    return Array.from(getTerminalUnitIds(db)).sort();
  }

  async function claimAndPrintBatch(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      const jobs = await claimPrintJobs(supabase, currentUnitIds(), getLocalDeviceId(db));
      for (const job of jobs) await handleJob(job);
    } finally {
      sweeping = false;
    }
  }

  async function claimAndPrintOne(jobId: string): Promise<void> {
    const job = await claimPrintJob(supabase, jobId, currentUnitIds(), getLocalDeviceId(db));
    if (!job) return; // outro terminal já reservou — nada a fazer
    await handleJob(job);
  }

  /**
   * (Re)assina o Realtime conforme a unidade amarrada a este terminal.
   * Um canal POR unidade, cada um com filtro no servidor: assim o
   * terminal nem recebe o evento das outras unidades, em vez de receber
   * tudo e torcer para o filtro do cliente segurar — que é como a
   * impressão de uma unidade saía também na outra.
   */
  function syncSubscription(): void {
    const unitIds = currentUnitIds();
    const key = unitIds.join(",");
    if (key === subscribedUnits) return;

    for (const channel of channels) void supabase.removeChannel(channel);
    channels = [];
    subscribedUnits = key;

    if (unitIds.length === 0) {
      console.warn(
        "[print-bridge] Terminal sem unidade amarrada — nenhum job será impresso aqui. Configurações > Impressoras > Este terminal.",
      );
      return;
    }

    for (const unitId of unitIds) {
      const channel = supabase
        .channel(`fa_kiosk_print_jobs_bridge_${unitId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "fa_kiosk_print_jobs", filter: `unit_id=eq.${unitId}` },
          (payload) => {
            const job = payload.new as PrintJobRow;
            const decision = shouldConsiderJob({ job, allowedUnits: getTerminalUnitIds(db), deviceId: getLocalDeviceId(db) });
            if (!decision.accept) {
              console.log(`[print-bridge] ${decision.reason}`);
              return;
            }
            void claimAndPrintOne(job.id);
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error(
              `[print-bridge] canal Realtime da unidade ${unitId} caiu (${status}) — o sweep de ${SWEEP_INTERVAL_MS / 1000}s continua entregando os jobs.`,
            );
          } else {
            console.log(`[print-bridge] canal Realtime da unidade ${unitId}: ${status}`);
          }
        });
      channels.push(channel);
    }

    void claimAndPrintBatch();
  }

  // Amarrar o terminal na tela passa a valer na hora, sem reiniciar o app.
  onPrintBridgeRebind(() => syncSubscription());

  syncSubscription();
  setInterval(() => {
    syncSubscription();
    void claimAndPrintBatch();
  }, SWEEP_INTERVAL_MS);

  const bound = currentUnitIds().length > 0;
  if (!bound) {
    const reason =
      "Este computador ainda não foi vinculado a uma unidade. Abra Configurações > Impressoras > Este terminal e escolha a unidade — enquanto isso, nada será impresso aqui.";
    bridgeStatus = { started: false, bound: false, hasServiceRoleKey: true, reason, lastError: reason };
    return bridgeStatus;
  }

  bridgeStatus = { started: true, bound: true, hasServiceRoleKey: true, reason: undefined, lastError: null };
  return bridgeStatus;
}
