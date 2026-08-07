import { PayrollCsvDownloadButton } from "./PayrollCsvDownloadButton";
import type { ClosedPayrollItem } from "./FolhaPagamentoTable";

interface PayrollRunSummary {
  id: string;
  year: number;
  month: number;
  monthLabel: string;
  totalCents: number;
  createdAtMs: number;
  items: ClosedPayrollItem[];
}

export function PayrollHistory({ runs }: { runs: PayrollRunSummary[] }) {
  if (runs.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>Nenhuma folha fechada ainda.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {runs.map((run) => (
        <div
          key={run.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface-card)",
            borderRadius: "var(--radius-card)",
            padding: "10px 16px",
          }}
        >
          <div>
            <strong>
              {run.monthLabel}/{run.year}
            </strong>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Fechada em {new Date(run.createdAtMs).toLocaleString("pt-BR")} — Total:{" "}
              {(run.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
          </div>
          <PayrollCsvDownloadButton items={run.items} filenameSuffix={`${run.year}-${String(run.month).padStart(2, "0")}`} />
        </div>
      ))}
    </div>
  );
}
