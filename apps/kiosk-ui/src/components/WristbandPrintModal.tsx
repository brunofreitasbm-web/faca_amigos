import { useState } from "react";
import { Button, Modal, Tag } from "@facaamigos/ui";
import { generateGainschaGS2208DTSPL } from "@facaamigos/domain";
import { Api, systemStatus } from "../api/client.js";
import { useAppState } from "../state/AppState.js";

export interface WristbandData {
  wristbandCode: string;
  childName: string;
  guardianName: string;
  phone: string;
  planName?: string;
  notes?: string;
  entryTime?: string;
}

interface WristbandPrintModalProps {
  data: WristbandData;
  onClose: () => void;
}

export function WristbandPrintModal({ data, onClose }: WristbandPrintModalProps) {
  const { unit } = useAppState();
  const nowStr = data.entryTime || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const [showTspl, setShowTspl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [queueStatus, setQueueStatus] = useState<"idle" | "queuing" | "queued" | "error">("idle");

  const tsplCommands = generateGainschaGS2208DTSPL({
    ...data,
    entryTime: nowStr,
  });

  async function handleQueuePrint() {
    if (!unit) {
      handleBrowserPrint();
      return;
    }
    setQueueStatus("queuing");
    try {
      await Api.queuePrintJob(unit.id, "WRISTBAND", { ...data, entryTime: nowStr });
      setQueueStatus("queued");
    } catch {
      setQueueStatus("error");
      handleBrowserPrint();
    }
  }

  function handleBrowserPrint() {
    const printableElement = document.querySelector(".wristband-printable");
    if (!printableElement) {
      setTimeout(() => window.print(), 50);
      return;
    }

    const printWindow = window.open("", "_blank", "width=800,height=300");
    if (!printWindow) {
      systemStatus.dispatchEvent(new CustomEvent("print-blocked"));
      setTimeout(() => window.print(), 50);
      return;
    }
    systemStatus.dispatchEvent(new CustomEvent("print-ok"));

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Impressão de Pulseira — FaçaAmigos</title>
          <style>
            /* Sem a palavra "landscape" aqui: combinada com um tamanho
               explícito width×height ela é redundante (270mm > 20mm já
               define a orientação) e faz o Chrome travar no "Carregando
               visualização..." da caixa de impressão indefinidamente. */
            @page {
              size: 270mm 20mm;
              margin: 0;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              font-family: Arial, Helvetica, sans-serif !important;
              -webkit-print-color-adjust: exact;
            }
            .wristband-printable {
              width: 270mm;
              height: 20mm;
              padding: 1mm 4mm;
              margin: 0;
              box-sizing: border-box;
              display: flex;
              flex-direction: row;
              align-items: center;
              justify-content: space-between;
              background: #ffffff;
              color: #000000;
            }
          </style>
        </head>
        <body>
          <div class="wristband-printable">
            ${printableElement.innerHTML}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function handleCopyTspl() {
    navigator.clipboard.writeText(tsplCommands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal
      title={
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>Impressão de Pulseira</span>
          <Tag color="var(--color-teal)">Gainscha GS-2208D (20mm × 270mm Paisagem)</Tag>
        </span>
      }
      onClose={onClose}
      maxWidth="780px"
      zIndex={9999}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
        {/* Pré-visualização na tela em modo paisagem */}
        <div
          style={{
            background: "#ffffff",
            color: "#141414",
            padding: "8px 16px",
            borderRadius: "12px",
            border: "2px dashed var(--border-subtle)",
            fontFamily: "var(--font-body)",
            overflowX: "auto",
          }}
        >
          <div className="wristband-printable" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "16px", minWidth: "680px" }}>
            <div style={{ borderRight: "2px solid #141414", paddingRight: "12px" }}>
              <strong style={{ fontFamily: "Fredoka, sans-serif", fontSize: "16px", color: "#F0196B", display: "block" }}>
                FaçaAmigos
              </strong>
              <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}>
                Playground Inclusivo
              </span>
            </div>

            <div style={{ textAlign: "center", borderRight: "2px solid #141414", paddingRight: "12px" }}>
              <div style={{ fontSize: "18px", fontWeight: "bold", letterSpacing: "1px", background: "#f0f0f0", padding: "2px 8px", borderRadius: "4px" }}>
                #{data.wristbandCode}
              </div>
            </div>

            <div style={{ borderRight: "2px solid #141414", paddingRight: "12px" }}>
              <div style={{ fontSize: "11px", color: "#666" }}>Criança:</div>
              <div style={{ fontSize: "15px", fontWeight: "800" }}>{data.childName}</div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "#444" }}>
                Resp: {data.guardianName} ({data.phone})
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px" }}>
                <strong>Entrada:</strong> {nowStr} {data.planName ? `| ${data.planName}` : ""}
              </div>
              {data.notes && (
                <div style={{ fontSize: "10px", color: "#d9534f", fontWeight: "bold" }}>
                  ⚠️ OBS: {data.notes}
                </div>
              )}
            </div>
          </div>
        </div>

        {showTspl && (
          <div style={{ background: "#1e1e1e", color: "#4af626", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "11px", whiteSpace: "pre-wrap", maxHeight: "160px", overflowY: "auto" }}>
            <strong>Comandos Gainscha TSPL (RAW):</strong>
            <br />
            {tsplCommands}
          </div>
        )}

        {queueStatus === "queued" && <Tag color="var(--color-teal)">✓ Enviado para a impressora configurada</Tag>}
        {queueStatus === "error" && <Tag color="var(--color-amber)">⚠️ Fila de impressão indisponível — abrindo diálogo do navegador</Tag>}

        <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
          <Button variant="ghost" size="sm" onClick={() => setShowTspl(!showTspl)}>
            {showTspl ? "Ocultar TSPL" : "Ver Código TSPL"}
          </Button>

          {showTspl && (
            <Button variant="secondary" size="sm" onClick={handleCopyTspl}>
              {copied ? "Copiado! ✓" : "Copiar TSPL"}
            </Button>
          )}

          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <Button variant="ghost" onClick={handleBrowserPrint} title="Abrir o diálogo de impressão do navegador manualmente">
              Imprimir pelo navegador
            </Button>
            {/* "Fechar" some — o ✕ do Modal já faz o mesmo, sem duplicar. */}
            <Button variant="primary" loading={queueStatus === "queuing"} onClick={handleQueuePrint}>
              🖨️ Imprimir Pulseira (Gainscha)
            </Button>
          </div>
        </div>
    </Modal>
  );
}

