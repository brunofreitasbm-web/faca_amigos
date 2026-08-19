import { useEffect } from "react";
import { supabase } from "../lib/supabase/client.js";
import { useToast } from "../state/ToastContext.js";

/**
 * Antes disso, um job de impressão que falhasse (impressora errada,
 * ponte desligada, sem papel) só virava `status = FAILED` silenciosamente
 * em fa_kiosk_print_jobs — ninguém no balcão ficava sabendo, e a família
 * só descobria que a pulseira/recibo não saiu depois de já ter ido embora.
 */
export function usePrintFailureAlerts(unitId: string | null | undefined): void {
  const toast = useToast();

  useEffect(() => {
    if (!unitId) return;

    const channel = supabase()
      .channel(`fa_kiosk_print_jobs_alerts_${unitId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fa_kiosk_print_jobs", filter: `unit_id=eq.${unitId}` },
        (payload) => {
          const row = payload.new as { status?: string; kind?: string; error?: string | null; pdf_url?: string | null };
          if (row.status === "FAILED") {
            const label = row.kind === "WRISTBAND" ? "pulseira" : "recibo";
            toast.error(`Falha ao imprimir ${label}: ${row.error ?? "erro desconhecido"}. Veja Configurações > Impressoras.`);
          } else if (row.status === "SAVED_PDF") {
            toast.error(`Impressora de cupom indisponível. Cupom salvo em PDF (disponível por 10 dias).`);
            if (row.pdf_url) {
              window.dispatchEvent(
                new CustomEvent("fa-open-pdf-receipt", {
                  detail: { pdfUrl: row.pdf_url, error: row.error },
                }),
              );
            }
          }
        },
      )
      .subscribe();

    return () => {
      void supabase().removeChannel(channel);
    };
  }, [unitId, toast]);
}
