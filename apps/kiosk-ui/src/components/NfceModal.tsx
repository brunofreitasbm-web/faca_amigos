import { useEffect, useState } from "react";
import { Button, Modal, Tag, HelpText } from "@facaamigos/ui";
import { generateDanfeNfce, gerarQrCodeDataUrl, formatarChaveAcessoEmGrupos, type DanfeNfcePayload } from "@facaamigos/fiscal";
import type { FiscalDoc } from "../api/client.js";

interface NfceModalProps {
  doc: FiscalDoc | null;
  unitName: string;
  orderCode?: string;
  items?: Array<{ description: string; quantity: number; amountCents: number }>;
  payments?: Array<{ method: string; amountCents: number }>;
  fiscalCpf?: string | null;
  onClose: () => void;
}

const STATUS_LABEL: Record<FiscalDoc["status"], string> = {
  PENDENTE: "Na fila de transmissão",
  BLOQUEADO: "Bloqueada (correção necessária)",
  DESCARTADO: "Descartada",
  ASSINADO: "Assinada, aguardando transmissão",
  TRANSMITIDO: "Transmitida, aguardando resposta da SEFAZ",
  AUTORIZADO: "Autorizada",
  REJEITADO: "Rejeitada pela SEFAZ",
  DENEGADO: "Denegada pela SEFAZ",
  A_INUTILIZAR: "Numeração a inutilizar",
  CONTINGENCIA_OFFLINE: "Contingência offline",
  CANCELADO: "Cancelada",
};

import { Api } from "../api/client.js";

/**
 * Cupom NFC-e de uma venda do PDV.
 * Exibe o DANFE NFC-e quando autorizado pela SEFAZ ou o Comprovante Auxiliar de Venda
 * nos demais casos, permitindo sempre impressão, exportação em PDF e envio por WhatsApp.
 */
export function NfceModal({ doc, unitName, orderCode, items = [], payments = [], fiscalCpf, onClose }: NfceModalProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const isAutorizado = doc?.status === "AUTORIZADO";
  const isContingencia = doc?.status === "CONTINGENCIA_OFFLINE" || doc?.emission_type === "CONTINGENCIA_OFFLINE";
  const isPendente = !doc || doc.status === "PENDENTE" || doc.status === "ASSINADO" || doc.status === "TRANSMITIDO";
  const isErro = doc?.status === "BLOQUEADO" || doc?.status === "REJEITADO" || doc?.status === "DENEGADO";

  const totalCents = doc?.total_cents ?? items.reduce((sum, item) => sum + item.amountCents, 0);
  const emissionMs = doc?.authorized_at_ms ?? doc?.created_at_ms;
  const dateTimeStr = emissionMs ? new Date(emissionMs).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR");

  // Dados fiscais só valem depois da autorização.
  const accessKey = isAutorizado ? (doc?.access_key ?? null) : null;
  const qrCodeUrl = isAutorizado ? (doc?.qrcode_url ?? null) : null;
  const canRenderDanfe = isAutorizado && !!accessKey;

  const danfe = canRenderDanfe
    ? generateDanfeNfce({
        unitName,
        dateTime: dateTimeStr,
        items,
        totalCents,
        payments,
        trocoCents: 0,
        chaveAcesso: accessKey ?? "",
        numero: doc?.numero ?? 0,
        serie: Number(doc?.serie ?? 1),
        protocolo: doc?.protocol_number ?? "—",
        qrCodeUrl: qrCodeUrl ?? "",
        consumidorCpf: fiscalCpf ?? null,
        contingencia: isContingencia,
      } satisfies DanfeNfcePayload)
    : null;

  const statusLabel = doc ? STATUS_LABEL[doc.status] ?? doc.status : "Sem documento fiscal";
  const errorText = doc?.last_error ?? doc?.reject_message ?? null;

  function buildAuxiliaryReceiptText(): string {
    const lines: string[] = [];
    lines.push("================================================");
    lines.push("               FAÇA AMIGOS                      ");
    lines.push(`           ${unitName.toUpperCase()}`);
    lines.push("================================================");
    lines.push("           COMPROVANTE AUXILIAR DE VENDA        ");
    lines.push("        DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA   ");
    lines.push("------------------------------------------------");
    if (orderCode) lines.push(`Pedido nº ${orderCode}`);
    lines.push(`Data/Hora: ${dateTimeStr}`);
    lines.push("------------------------------------------------");
    lines.push("ITEM                                QTD    VALOR");
    lines.push("------------------------------------------------");
    for (const item of items) {
      const desc = item.description.padEnd(28, " ").slice(0, 28);
      const qty = String(item.quantity).padStart(4, " ");
      const val = (item.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(10, " ");
      lines.push(`${desc} ${qty} R$ ${val}`);
    }
    lines.push("------------------------------------------------");
    lines.push(`TOTAL:                                 R$ ${(totalCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(10, " ")}`);

    if (payments.length > 0) {
      lines.push("------------------------------------------------");
      lines.push("FORMA DE PAGAMENTO:");
      for (const p of payments) {
        const pVal = (p.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(10, " ");
        lines.push(` - ${p.method.padEnd(20, " ")} R$ ${pVal}`);
      }
    }

    lines.push("------------------------------------------------");
    lines.push(fiscalCpf ? `CONSUMIDOR CPF: ${fiscalCpf}` : "CONSUMIDOR NÃO IDENTIFICADO");
    lines.push("------------------------------------------------");
    lines.push(`SITUAÇÃO FISCAL: ${statusLabel.toUpperCase()}`);
    if (doc?.numero != null) {
      lines.push(`Numeração Reservada: NFC-e nº ${doc.numero} / série ${doc.serie ?? "1"}`);
    }
    lines.push("================================================");
    return lines.join("\n");
  }

  const receiptText = danfe ? danfe.text : buildAuxiliaryReceiptText();

  useEffect(() => {
    if (!qrCodeUrl) {
      setQrCodeDataUrl(null);
      return;
    }
    let cancelled = false;
    gerarQrCodeDataUrl(qrCodeUrl)
      .then((url) => {
        if (!cancelled) setQrCodeDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrCodeUrl]);

  async function handleRetryNfce() {
    if (!doc) return;
    setRetryBusy(true);
    setRetryMsg(null);
    try {
      await Api.retryNfce(doc.id);
      setRetryMsg("✅ Reenviado para transmissão! Uma nova numeração e chave de acesso foram reservadas para evitar duplicidade.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao tentar novamente";
      setRetryMsg(`❌ ${msg}`);
    } finally {
      setRetryBusy(false);
    }
  }

  function handlePrint() {
    let iframe = document.getElementById("fa-nfce-print-iframe") as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "fa-nfce-print-iframe";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);
    }

    const docIframe = iframe.contentDocument || iframe.contentWindow?.document;
    if (!docIframe) {
      window.print();
      return;
    }

    docIframe.open();
    docIframe.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>DANFE NFC-e / Comprovante — FaçaAmigos</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: "Consolas", "Courier New", monospace;
              font-size: 11px;
              line-height: 1.2;
              width: 80mm;
              margin: 0;
              padding: 4mm;
              box-sizing: border-box;
              color: #000;
              background: #fff;
            }
            pre {
              white-space: pre-wrap;
              word-break: break-all;
              margin: 0;
              font-family: inherit;
            }
            .qr-container {
              text-align: center;
              margin: 10px 0;
            }
            .qr-container img {
              width: 140px;
              height: 140px;
            }
          </style>
        </head>
        <body>
          <pre>${receiptText}</pre>
          ${
            qrCodeDataUrl
              ? `<div class="qr-container"><img src="${qrCodeDataUrl}" alt="QR Code NFC-e" /></div>`
              : ""
          }
        </body>
      </html>
    `);
    docIframe.close();

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error("Erro ao imprimir cupom NFC-e:", err);
      }
    }, 150);
  }

  function handleOpenPdf() {
    const printWin = window.open("", "_blank");
    if (!printWin) return;
    printWin.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Comprovante de Venda — FaçaAmigos ${orderCode ? `#${orderCode}` : ""}</title>
          <style>
            body {
              font-family: "Consolas", "Courier New", monospace;
              font-size: 12px;
              line-height: 1.3;
              max-width: 400px;
              margin: 20px auto;
              padding: 20px;
              border: 1px solid #ccc;
              border-radius: 8px;
              background: #fff;
              color: #111;
            }
            pre {
              white-space: pre-wrap;
              word-break: break-all;
              margin: 0;
              font-family: inherit;
            }
            .qr-container {
              text-align: center;
              margin-top: 16px;
            }
            .qr-container img {
              width: 150px;
              height: 150px;
            }
            .no-print {
              margin-bottom: 16px;
              text-align: center;
            }
            @media print {
              .no-print { display: none; }
              body { border: none; margin: 0; padding: 0; max-width: 100%; }
            }
          </style>
        </head>
        <body>
          <div class="no-print">
            <button onclick="window.print()" style="padding: 8px 16px; font-size: 14px; cursor: pointer; background: #2ECFB5; color: #fff; border: none; border-radius: 6px; font-weight: bold;">
              🖨️ Salvar como PDF / Imprimir
            </button>
          </div>
          <pre>${receiptText}</pre>
          ${qrCodeDataUrl ? `<div class="qr-container"><img src="${qrCodeDataUrl}" alt="QR Code NFC-e" /></div>` : ""}
        </body>
      </html>
    `);
    printWin.document.close();
  }

  function handleWhatsAppSend() {
    const textLines = [
      `*FaçaAmigos — Comprovante de Venda* (${unitName})`,
      orderCode ? `Pedido: #${orderCode}` : "",
      `Data: ${dateTimeStr}`,
      `Total: R$ ${(totalCents / 100).toFixed(2).replace(".", ",")}`,
      "",
      "Itens:",
      ...items.map((it) => `- ${it.quantity}x ${it.description} (R$ ${(it.amountCents / 100).toFixed(2).replace(".", ",")})`),
      "",
      accessKey ? `✅ NFC-e Autorizada: ${accessKey}` : `Status Fiscal: ${statusLabel}`,
    ].filter(Boolean).join("\n");

    window.open(`https://wa.me/?text=${encodeURIComponent(textLines)}`, "_blank");
  }

  return (
    <Modal
      title={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>
            Cupom Fiscal / Comprovante {orderCode ? `(#${orderCode})` : ""}
          </span>
          {isAutorizado && <Tag color="var(--color-teal, #2ECFB5)">✅ Autorizado SEFAZ-PA</Tag>}
          {isContingencia && <Tag color="var(--color-amber, #F59E0B)">⚠️ Contingência Offline</Tag>}
          {isPendente && <Tag color="var(--color-info, #3B82F6)">⏳ Processando Nota Fiscal</Tag>}
          {isErro && <Tag color="var(--color-error-text, #EF4444)">❌ Erro na Emissão</Tag>}
        </div>
      }
      onClose={onClose}
      maxWidth="540px"
      zIndex={9999}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {isPendente && (
        <div style={{ background: "#E0F2FE", color: "#0369A1", padding: "10px 14px", borderRadius: "8px", fontSize: "13px" }}>
          ⏳ A venda foi registrada com sucesso! A nota fiscal está na fila de transmissão da SEFAZ e será autorizada em segundo plano.
        </div>
      )}

      {isContingencia && (
        <div style={{ background: "#FEF3C7", color: "#92400E", padding: "10px 14px", borderRadius: "8px", fontSize: "13px" }}>
          ⚠️ Nota fiscal gerada em <strong>Contingência Offline</strong>. A transmissão final à SEFAZ ocorrerá automaticamente.
        </div>
      )}

      {isErro && (
        <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            ❌ <strong>Falha no processamento fiscal{doc?.reject_code ? ` (código ${doc.reject_code})` : ""}:</strong>{" "}
            {errorText ?? "Verifique os dados fiscais da unidade ou tente o reenvio automático."}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="primary" size="sm" onClick={handleRetryNfce} loading={retryBusy}>
              🔄 Tentar Novamente na SEFAZ
            </Button>
          </div>
        </div>
      )}

      {retryMsg && (
        <div style={{ background: "#F0FDF4", color: "#166534", padding: "10px 14px", borderRadius: "8px", fontSize: "13px" }}>
          {retryMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: "260px" }}>
          <pre
            style={{
              background: "#ffffff",
              color: "#141414",
              padding: "12px",
              borderRadius: "8px",
              border: "1px dashed var(--border-subtle, #ccc)",
              fontFamily: '"Consolas", "Courier New", monospace',
              fontSize: "11px",
              lineHeight: "1.25",
              fontWeight: 600,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "300px",
              overflowY: "auto",
              margin: 0,
            }}
          >
            {receiptText}
          </pre>
        </div>

        {qrCodeDataUrl ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid var(--border-subtle, #eee)" }}>
            <img src={qrCodeDataUrl} alt="QR Code Consulta NFC-e" style={{ width: "130px", height: "130px" }} />
            <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", maxWidth: "130px" }}>
              Escaneie para consultar na SEFAZ-PA
            </span>
          </div>
        ) : (
          <HelpText style={{ maxWidth: "150px", fontSize: "11px" }}>
            {isAutorizado ? "Gerando QR Code..." : "QR Code fiscal será incluído assim que a SEFAZ autorizar a NFC-e."}
          </HelpText>
        )}
      </div>

      {accessKey && (
        <HelpText style={{ fontSize: "11px", wordBreak: "break-all" }}>
          <strong>Chave de Acesso:</strong> {formatarChaveAcessoEmGrupos(accessKey)}
          <br />
          <strong>Protocolo:</strong> {doc?.protocol_number ?? "—"}
        </HelpText>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={handleWhatsAppSend} title="Enviar resumo do comprovante por WhatsApp para o cliente">
            📱 Enviar WhatsApp
          </Button>
          <Button variant="secondary" onClick={handleOpenPdf} title="Abrir em nova aba para salvar em PDF ou imprimir em folha A4">
            📄 Baixar / Ver PDF
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" onClick={handlePrint} title="Imprimir comprovante térmico (80mm)">
            🖨️ Imprimir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

