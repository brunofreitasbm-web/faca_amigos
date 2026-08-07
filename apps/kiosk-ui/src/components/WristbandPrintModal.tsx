import { useState } from "react";
import { Button, Modal, Tag, HelpText } from "@facaamigos/ui";
import { generateGainschaGS2208DTSPL } from "@facaamigos/domain";
import { Api, systemStatus } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { WristbandLabelPreview } from "./WristbandLabelPreview.js";

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
          <WristbandLabelPreview data={data} entryTime={nowStr} />
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

        <HelpText>
          Use o botão rosa "Imprimir Pulseira" no dia a dia — ele manda direto para a impressora configurada.
          "Imprimir pelo navegador" e "Ver Código TSPL" são alternativas técnicas, só para quando o suporte pedir
          ou a impressora configurada não estiver funcionando.
        </HelpText>

        <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
          <Button variant="ghost" size="sm" title="Mostrar o código técnico enviado à impressora (uso do suporte técnico)" onClick={() => setShowTspl(!showTspl)}>
            {showTspl ? "Ocultar TSPL" : "Ver Código TSPL"}
          </Button>

          {showTspl && (
            <Button variant="secondary" size="sm" title="Copiar o código técnico para enviar ao suporte" onClick={handleCopyTspl}>
              {copied ? "Copiado! ✓" : "Copiar TSPL"}
            </Button>
          )}

          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <Button variant="ghost" onClick={handleBrowserPrint} title="Alternativa: abrir o diálogo de impressão do navegador manualmente, se a impressão automática falhar">
              Imprimir pelo navegador
            </Button>
            {/* "Fechar" some — o ✕ do Modal já faz o mesmo, sem duplicar. */}
            <Button
              variant="primary"
              loading={queueStatus === "queuing"}
              title="Enviar a pulseira para a impressora configurada nesta unidade"
              onClick={handleQueuePrint}
            >
              🖨️ Imprimir Pulseira (Gainscha)
            </Button>
          </div>
        </div>
    </Modal>
  );
}

