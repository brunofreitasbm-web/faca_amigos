import { useEffect } from "react";
import { generateEscPosReceipt } from "@facaamigos/domain";
import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { Api, systemStatus } from "../api/client.js";
import { useAppState } from "../state/AppState.js";

interface ReceiptPrintModalProps {
  data: ReceiptPrintPayload;
  onClose: () => void;
}

/**
 * Impressão automática de cupom não fiscal (80mm / Apptech T271U):
 * Ao efetuar qualquer pagamento (check-in, checkout, PDV), este componente
 * enfileira o cupom em `fa_kiosk_print_jobs` para ser impresso SILENCIOSA
 * E AUTOMATICAMENTE pelo print bridge local, sem exibir nenhum pop-up na tela
 * e sem exigir qualquer clique do operador.
 */
export function ReceiptPrintModal({ data, onClose }: ReceiptPrintModalProps) {
  const { unit } = useAppState();
  const { text } = generateEscPosReceipt(data);

  function handleBrowserPrint() {
    let iframe = document.getElementById("fa-receipt-print-iframe") as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "fa-receipt-print-iframe";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Cupom Não Fiscal — FaçaAmigos</title>
          <style>
            @page { size: 80mm auto; margin: 0; }
            html, body { margin: 0 !important; padding: 2mm 3mm !important; background: #fff !important; width: 74mm; font-family: "Consolas", "Courier New", monospace; font-size: 11px; line-height: 1.25; font-weight: 600; text-rendering: geometricPrecision; color: #000 !important; text-align: center; }
            pre { font-family: inherit; font-size: inherit; white-space: pre; margin: 0; width: 100%; overflow: hidden; word-break: break-all; text-align: center; }
          </style>
        </head>
        <body>
          <pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
        </body>
      </html>
    `);
    doc.close();

    systemStatus.dispatchEvent(new CustomEvent("print-ok"));

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error("Erro ao disparar impressão do iframe do cupom:", err);
      }
    }, 150);
  }

  useEffect(() => {
    let isMounted = true;

    if (!unit) {
      handleBrowserPrint();
      onClose();
      return;
    }

    Api.queuePrintJob(unit.id, "RECEIPT", data)
      .then(() => {
        if (isMounted) {
          onClose();
        }
      })
      .catch((err) => {
        console.warn("Fila de impressão indisponível, disparando impressão automática:", err);
        if (isMounted) {
          handleBrowserPrint();
          onClose();
        }
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retorna null para não exibir NENHUM modal ou pop-up na tela do operador
  return null;
}
