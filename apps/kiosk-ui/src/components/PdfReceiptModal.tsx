import { useState, useEffect } from "react";

interface PdfReceiptModalProps {
  pdfUrl: string;
  error?: string | null;
  onClose: () => void;
}

export function PdfReceiptModal({ pdfUrl, error, onClose }: PdfReceiptModalProps) {
  const [downloading, setDownloading] = useState(false);

  function handleDownload() {
    try {
      setDownloading(true);
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.download = `cupom_nao_fiscal_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Erro ao baixar PDF:", err);
    } finally {
      setDownloading(false);
    }
  }

  function handlePrint() {
    const printWin = window.open(pdfUrl, "_blank");
    if (printWin) {
      printWin.focus();
      printWin.print();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xl">
              📄
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">Cupom Salvo em PDF</h3>
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                {error || "Impressora de cupom ausente ou não conectada. Este PDF tem vida útil de 10 dias no servidor."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl font-bold p-1 leading-none rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Fechar"
          >
            &times;
          </button>
        </div>

        {/* PDF Viewer Body */}
        <div className="p-4 flex-1 bg-slate-100 dark:bg-slate-950 flex flex-col min-h-[400px]">
          <iframe
            src={pdfUrl}
            title="Cupom Não Fiscal PDF"
            className="w-full h-full min-h-[420px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white"
          />
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            ⏱️ Retenção automática: expirará em 10 dias
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-xl text-sm transition flex items-center gap-1.5"
            >
              🖨️ Imprimir
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-pink-600/20 transition flex items-center gap-1.5"
            >
              ⬇️ Baixar PDF
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 font-semibold rounded-xl text-sm transition"
            >
              Concluído
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Listener global para abrir o modal de PDF de qualquer lugar do app
 */
export function GlobalPdfReceiptModalListener() {
  const [activePdf, setActivePdf] = useState<{ pdfUrl: string; error?: string | null } | null>(null);

  useEffect(() => {
    function handleOpenPdf(e: Event) {
      const customEvent = e as CustomEvent<{ pdfUrl: string; error?: string | null }>;
      if (customEvent.detail?.pdfUrl) {
        setActivePdf({ pdfUrl: customEvent.detail.pdfUrl, error: customEvent.detail.error });
      }
    }

    window.addEventListener("fa-open-pdf-receipt", handleOpenPdf);
    return () => {
      window.removeEventListener("fa-open-pdf-receipt", handleOpenPdf);
    };
  }, []);

  if (!activePdf) return null;

  return (
    <PdfReceiptModal
      pdfUrl={activePdf.pdfUrl}
      error={activePdf.error}
      onClose={() => setActivePdf(null)}
    />
  );
}
