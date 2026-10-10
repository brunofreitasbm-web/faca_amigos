import { useUnsentSessionReports, usePendingSessionReports } from "../../api/useSessionReports.js";

/**
 * Contador na barra de navegação. Só é montado dentro do botão da tela, que já
 * é filtrado por capacidade — assim quem não pode preencher nunca dispara a RPC.
 *
 * Quando a Twilio recusa o envio automático do PDF, isso tem prioridade sobre
 * o contador normal de pendentes: pisca em vermelho até o operador reenviar
 * (automático) ou mandar o PDF na mão pelo WhatsApp dele (manual) — ver
 * RelatorioSessaoScreen e Api.sessionReportSendManualPdf.
 */
export function PendingSessionReportsBadge({ unitId }: { unitId: string | null }) {
  const { pending, overdueCount } = usePendingSessionReports(unitId);
  const { unsentCount: failedCount } = useUnsentSessionReports(unitId);

  if (failedCount > 0) {
    return (
      <span
        role="alert"
        aria-label={`${failedCount} Olhar FaçaAmigos sem envio ao responsável — reenvie ou mande o PDF manualmente`}
        style={{
          marginLeft: "6px",
          minWidth: "20px",
          padding: "0 6px",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 700,
          lineHeight: "20px",
          textAlign: "center",
          display: "inline-block",
          background: "var(--color-error-text, #b3261e)",
          color: "#fff",
          animation: "fa-session-report-alert-blink 1s step-start infinite",
        }}
      >
        ⚠️ {failedCount}
        <style>{`
          @keyframes fa-session-report-alert-blink {
            50% { opacity: 0.25; }
          }
        `}</style>
      </span>
    );
  }

  if (pending.length === 0) return null;
  return (
    <span
      aria-label={`${pending.length} relatórios pendentes${overdueCount ? `, ${overdueCount} atrasados` : ""}`}
      style={{
        marginLeft: "6px",
        minWidth: "20px",
        padding: "0 6px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 700,
        lineHeight: "20px",
        textAlign: "center",
        display: "inline-block",
        background: overdueCount > 0 ? "var(--color-error-text, #b3261e)" : "var(--color-amber)",
        color: overdueCount > 0 ? "#fff" : "#1a1a1a",
      }}
    >
      {pending.length}
    </span>
  );
}
