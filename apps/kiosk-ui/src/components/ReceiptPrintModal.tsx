import { useEffect, useState } from "react";
import { Button, Modal, Tag } from "@facaamigos/ui";
import { generateEscPosReceipt } from "@facaamigos/domain";
import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { Api, systemStatus } from "../api/client.js";
import { useAppState } from "../state/AppState.js";

interface ReceiptPrintModalProps {
  data: ReceiptPrintPayload;
  onClose: () => void;
}

/**
 * Cupom não fiscal (80mm): enfileira o pedido em fa_kiosk_print_jobs ao
 * abrir, sem exigir clique do operador nem abrir o diálogo nativo do
 * navegador — o print bridge local (apps/kiosk) assina essa fila e manda
 * direto para a impressora configurada em Configurações > Impressoras. Se
 * a fila falhar (ex.: sem unidade selecionada), cai no caminho antigo
 * (janela + window.print()) como último recurso — melhor um diálogo
 * aparecendo do que nenhum cupom saindo.
 */
export function ReceiptPrintModal({ data, onClose }: ReceiptPrintModalProps) {
  const { unit } = useAppState();
  const { text } = generateEscPosReceipt(data);
  const [status, setStatus] = useState<"queuing" | "queued" | "fallback">("queuing");

  function handleBrowserPrint() {
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
    if (!unit) {
      setStatus("fallback");
      handleBrowserPrint();
      return;
    }
    Api.queuePrintJob(unit.id, "RECEIPT", data)
      .then(() => setStatus("queued"))
      .catch(() => {
        setStatus("fallback");
        handleBrowserPrint();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal
      title={
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>Cupom Não Fiscal</span>
          <Tag color="var(--color-teal)">80mm</Tag>
        </span>
      }
      onClose={onClose}
      maxWidth="420px"
      zIndex={9999}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
        {status === "queued" && <Tag color="var(--color-teal)">✓ Enviado para a impressora configurada</Tag>}
        {status === "fallback" && <Tag color="var(--color-amber)">⚠️ Fila de impressão indisponível — abrindo diálogo do navegador</Tag>}

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
          <Button variant="ghost" onClick={handleBrowserPrint} title="Abrir o diálogo de impressão do navegador manualmente">
            🖨️ Imprimir pelo navegador
          </Button>
        </div>
    </Modal>
  );
}
