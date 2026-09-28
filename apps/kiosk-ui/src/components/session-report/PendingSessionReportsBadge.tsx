import { usePendingSessionReports } from "../../api/useSessionReports.js";

/**
 * Contador na barra de navegação. Só é montado dentro do botão da tela, que já
 * é filtrado por capacidade — assim quem não pode preencher nunca dispara a RPC.
 */
export function PendingSessionReportsBadge({ unitId }: { unitId: string | null }) {
  const { pending, overdueCount } = usePendingSessionReports(unitId);
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
