import { useState } from "react";
import { Button, Card, Tag } from "@facaamigos/ui";
import { generateGainschaGS2208DTSPL } from "@facaamigos/domain";

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
  const nowStr = data.entryTime || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const [showTspl, setShowTspl] = useState(false);
  const [copied, setCopied] = useState(false);

  const tsplCommands = generateGainschaGS2208DTSPL({
    ...data,
    entryTime: nowStr,
  });

  function handlePrint() {
    const printableElement = document.querySelector(".wristband-printable");
    if (!printableElement) {
      setTimeout(() => window.print(), 50);
      return;
    }

    const printWindow = window.open("", "_blank", "width=800,height=300");
    if (!printWindow) {
      setTimeout(() => window.print(), 50);
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Impressão de Pulseira — FaçaAmigos</title>
          <style>
            @page {
              size: 270mm 20mm landscape;
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
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <Card style={{ maxWidth: "780px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", margin: 0, color: "var(--color-primary)" }}>
            Impressão de Pulseira
          </h2>
          <Tag variant="info">Gainscha GS-2208D (20mm × 270mm Paisagem)</Tag>
        </div>

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
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            <Button variant="primary" onClick={handlePrint}>
              🖨️ Imprimir Pulseira (Gainscha)
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

