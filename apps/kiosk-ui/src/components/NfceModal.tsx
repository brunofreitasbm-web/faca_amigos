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

/**
 * Cupom NFC-e de uma venda do PDV. Só mostra chave de acesso e QR Code
 * quando o documento está AUTORIZADO — chave e URL do QR vêm prontas do
 * worker (que é quem tem o CSC); nunca são montadas aqui, porque uma chave
 * ou QR fabricados no cliente não têm valor fiscal e confundiriam o balcão.
 */
export function NfceModal({ doc, unitName, orderCode, items = [], payments = [], fiscalCpf, onClose }: NfceModalProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

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

  function handlePrint() {
    if (!danfe) return;
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
          <title>DANFE NFC-e — FaçaAmigos</title>
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
          <pre>${danfe.text}</pre>
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

  const statusLabel = doc ? STATUS_LABEL[doc.status] ?? doc.status : "Sem documento fiscal";
  const errorText = doc?.last_error ?? doc?.reject_message ?? null;

  return (
    <Modal
      title={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>
            Cupom Fiscal — NFC-e {orderCode ? `(#${orderCode})` : ""}
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
        <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: "8px", fontSize: "13px" }}>
          ❌ <strong>Falha no processamento fiscal{doc?.reject_code ? ` (código ${doc.reject_code})` : ""}:</strong>{" "}
          {errorText ?? "Verifique o NCM dos produtos, o CSC ou os dados da Inscrição Estadual em Gerencial > Dados Fiscais."}
        </div>
      )}

      {canRenderDanfe && danfe ? (
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
              {danfe.text}
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
              QR Code ainda não disponível para este documento (o emissor grava a URL do QR junto com a autorização).
            </HelpText>
          )}
        </div>
      ) : (
        <div style={{ background: "var(--surface-sunken, #F3F4F6)", padding: "12px 14px", borderRadius: "8px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <strong>Situação:</strong> {statusLabel}
          </div>
          {doc?.numero != null && (
            <div>
              <strong>Numeração reservada:</strong> NFC-e nº {doc.numero} / série {doc.serie ?? "1"}
            </div>
          )}
          {errorText && (
            <div>
              <strong>Detalhe:</strong> {errorText}
            </div>
          )}
          <HelpText style={{ margin: 0 }}>
            O cupom com chave de acesso e QR Code só fica disponível depois da autorização pela SEFAZ-PA.
          </HelpText>
        </div>
      )}

      {accessKey && (
        <HelpText style={{ fontSize: "11px", wordBreak: "break-all" }}>
          <strong>Chave de Acesso:</strong> {formatarChaveAcessoEmGrupos(accessKey)}
          <br />
          <strong>Protocolo:</strong> {doc?.protocol_number ?? "—"}
        </HelpText>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {isAutorizado ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <Button variant="ghost" disabled title="Cancelamento pela SEFAZ será liberado em uma próxima versão.">
              🚫 Solicitar Cancelamento
            </Button>
            <HelpText style={{ margin: 0, fontSize: "11px" }}>Cancelamento pela SEFAZ será liberado em uma próxima versão.</HelpText>
          </div>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" onClick={handlePrint} disabled={!canRenderDanfe}>
            🖨️ Imprimir DANFE NFC-e
          </Button>
        </div>
      </div>
    </Modal>
  );
}
