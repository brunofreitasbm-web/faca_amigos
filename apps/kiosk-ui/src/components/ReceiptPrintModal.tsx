import { useEffect } from "react";
import { Button, Card, Tag } from "@facaamigos/ui";
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
      <Card style={{ maxWidth: "420px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", margin: 0, color: "var(--color-primary)" }}>Cupom Não Fiscal</h2>
          <Tag color="var(--color-teal)" title="Impressão disparada automaticamente ao abrir esta janela">80mm</Tag>
        </div>

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
          <Button variant="ghost" onClick={onClose} title="Fechar esta janela">
            Fechar
          </Button>
          <Button variant="primary" onClick={handlePrint} title="Reimprimir caso o pop-up de impressão tenha sido bloqueado">
            🖨️ Reimprimir
          </Button>
        </div>
      </Card>
    </div>
  );
}
