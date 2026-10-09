import { useEffect } from "react";
import { supabase } from "../lib/supabase/client.js";
import { useToast } from "../state/ToastContext.js";

/**
 * Antes disso, quando a Twilio recusava o envio do Olhar FaçaAmigos (ex.
 * número sem WhatsApp, erro 63049), o relatório só virava `whatsapp_status =
 * FAILED` silenciosamente em fa_kiosk_session_reports — ninguém no balcão
 * ficava sabendo, e o responsável corria o risco de nunca receber o PDF. O
 * badge piscante da navegação (PendingSessionReportsBadge) cobre quem já
 * está no app; este hook avisa na hora, por toast, mesmo quem estiver em
 * outra tela — mesmo padrão de usePrintFailureAlerts.
 */
export function useSessionReportFailureAlerts(unitId: string | null | undefined): void {
  const toast = useToast();

  useEffect(() => {
    if (!unitId) return;

    const channel = supabase()
      .channel(`fa_session_reports_alerts_${unitId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fa_kiosk_session_reports", filter: `unit_id=eq.${unitId}` },
        (payload) => {
          const row = payload.new as { whatsapp_status?: string; child_name_snapshot?: string };
          if (row.whatsapp_status === "FAILED") {
            toast.error(
              `WhatsApp recusou o envio do Olhar FaçaAmigos de ${row.child_name_snapshot ?? "criança"}. Envie o PDF manualmente em "Olhar FaçaAmigos".`,
            );
          }
        },
      )
      .subscribe();

    return () => {
      void supabase().removeChannel(channel);
    };
  }, [unitId, toast]);
}
