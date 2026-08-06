import { useEffect } from "react";
import { Button, Modal, Tag } from "@facaamigos/ui";
import { generateEscPosReceipt } from "@facaamigos/domain";
import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { systemStatus } from "../api/client.js";

interface ReceiptPrintModalProps {
  data: ReceiptPrintPayload;
  onClose: () => void;
}

/**
 * Cupom não fiscal (80mm): dispara a impressão sozinho ao abrir (via
 * useEffect), sem exigir clique do operador — se o pop-up for
 * bloqueado pelo navegador, o botão "Reimprimir" cobre o caso.
 */
export function ReceiptPrintModal({ data, onClose }: ReceiptPrintModalProps) {
  const { text } = generateEscPosReceipt(data);

  function handlePrint() {
    const printWindow = window.open("", "_blank", "width=420,height=600");
    if (!printWindow) {
      systemStatus.dispatchEvent(new CustomEvent("print-blocked"));
      return;
    }
    systemStatus.dispatchEvent(new CustomEvent("print-ok"));

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Cupom Não Fiscal — FaçaAmigos</title>
          <style>
            @page { size: 80mm auto; margin: 0; }
            html, body { margin: 0 !important; padding: 4mm !important; background: #fff !important; }
            pre { font-family: "Courier New", monospace; font-size: 11px; white-space: pre-wrap; margin: 0; }
          </style>
        </head>
        <body>
          <pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
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

  useEffect(() => {
    handlePrint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal
      title={
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>Cupom Não Fiscal</span>
          <Tag color="var(--color-teal)" title="Impressão disparada automaticamente ao abrir esta janela">80mm</Tag>
        </span>
      }
      onClose={onClose}
      maxWidth="420px"
      zIndex={9999}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
        <pre
          style={{
            background: "#ffffff",
            color: "#141414",
            padding: "12px",
            borderRadius: "12px",
            border: "2px dashed var(--border-subtle)",
            fontFamily: "monospace",
            fontSize: "10px",
            whiteSpace: "pre-wrap",
            maxHeight: "320px",
            overflowY: "auto",
          }}
        >
          {text}
        </pre>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          {/* "Fechar" some — o ✕ do Modal já faz o mesmo, sem duplicar. */}
          <Button variant="primary" onClick={handlePrint} title="Reimprimir caso o pop-up de impressão tenha sido bloqueado">
            🖨️ Reimprimir
          </Button>
        </div>
    </Modal>
  );
}
