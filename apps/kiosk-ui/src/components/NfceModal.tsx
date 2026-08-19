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

export function NfceModal({ doc, unitName, orderCode, items = [], payments = [], fiscalCpf, onClose }: NfceModalProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  const isAutorizado = doc?.status === "AUTORIZADO";
  const isContingencia = doc?.status === "CONTINGENCIA_OFFLINE" || doc?.emission_type === "CONTINGENCIA_OFFLINE";
  const isPendente = !doc || doc.status === "PENDENTE" || doc.status === "ASSINADO" || doc.status === "TRANSMITIDO";
  const isErro = doc?.status === "BLOQUEADO" || doc?.status === "REJEITADO" || doc?.status === "DENEGADO";

  const totalCents = doc?.total_cents ?? items.reduce((sum, item) => sum + item.amountCents, 0);
  const nowStr = doc?.created_at_ms ? new Date(doc.created_at_ms).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR");

  const defaultQrUrl = doc?.access_key
    ? `https://www.sefaz.pa.gov.br/nfce/consulta?chNFe=${doc.access_key}`
    : `https://www.sefaz.pa.gov.br/nfce/consulta`;

  const payload: DanfeNfcePayload = {
    unitName,
    dateTime: nowStr,
    items,
    totalCents,
    payments,
    trocoCents: 0,
    chaveAcesso: doc?.access_key ?? "00000000000000000000000000000000000000000000",
    numero: doc?.numero ?? 0,
    serie: Number(doc?.serie ?? 1),
    protocolo: doc?.protocol_number ?? (isPendente ? "AGUARDANDO TRANSAÇÃO" : "N/A"),
    qrCodeUrl: defaultQrUrl,
    consumidorCpf: fiscalCpf ?? null,
    contingencia: isContingencia,
  };

  const danfe = generateDanfeNfce(payload);

  useEffect(() => {
    gerarQrCodeDataUrl(defaultQrUrl)
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(null));
  }, [defaultQrUrl]);

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

  return (
    <Modal
      title={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>
            Cupom Fiscal — NFC-e {orderCode ? `(#${orderCode})` : ""}
          </span>
          {isAutorizado && <Tag color="var(--color-teal, #2ECFB5)">✅ Autorizado SEFAZ</Tag>}
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
          ⚠️ Nota fiscal gerada em <strong>Contingência Offline</strong>. O cupom auxiliar (DANFE) já é válido e a transmissão final à SEFAZ ocorrerá automaticamente.
        </div>
      )}

      {isErro && (
        <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: "8px", fontSize: "13px" }}>
          ❌ <strong>Falha no processamento fiscal:</strong> {doc?.last_error || doc?.reject_message || "Verifique o NCM dos produtos ou os dados da Inscrição Estadual em Configurações > Dados Fiscais."}
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
            {danfe.text}
          </pre>
        </div>

        {qrCodeDataUrl && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid var(--border-subtle, #eee)" }}>
            <img src={qrCodeDataUrl} alt="QR Code Consulta NFC-e" style={{ width: "130px", height: "130px" }} />
            <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", maxWidth: "130px" }}>
              Escaneie para consultar na SEFAZ
            </span>
          </div>
        )}
      </div>

      {doc?.access_key && (
        <HelpText style={{ fontSize: "11px", wordBreak: "break-all" }}>
          <strong>Chave de Acesso:</strong> {formatarChaveAcessoEmGrupos(doc.access_key)}
        </HelpText>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
        <Button variant="primary" onClick={handlePrint}>
          🖨️ Imprimir DANFE NFC-e
        </Button>
      </div>
    </Modal>
  );
}
