import { useEffect, useState } from "react";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { unitBrandFor } from "../branding/unitBrand.js";

type FrequenciaRow = Awaited<ReturnType<typeof Api.frequenciaRecords>>[number];

function pontoStatusLabel(kind: FrequenciaRow["kind"]): { label: string; color: string } {
  switch (kind) {
    case "ENTRADA":
      return { label: "no turno", color: "#1D8273" };
    case "INTERVALO_FIM":
      return { label: "voltou do intervalo", color: "#1D8273" };
    case "INTERVALO_INICIO":
      return { label: "em intervalo", color: "#996D18" };
    case "SAIDA":
      return { label: "saiu", color: "var(--text-muted)" };
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Equipe — quem bateu ponto hoje, nas 3 unidades, com o status de agora.
 *
 * O desenho original chamava isto de "escala", mas não existe agenda de
 * turnos futuros no banco — só o registro de ponto (Portaria MTP
 * 671/2021, mesma fonte de PontoScreen/FrequenciaTab). Mostrar só quem
 * bateu ponto de verdade, sem inventar quem "deveria" estar e não veio.
 */
export function MobileEquipe({ units, onBack }: { units: Unit[]; onBack: () => void }) {
  const [rows, setRows] = useState<FrequenciaRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    Api.frequenciaRecords(null, startOfDay.getTime(), Date.now())
      .then((all) => {
        if (!alive) return;
        const lastByEmployee = new Map<string, FrequenciaRow>();
        for (const row of all) {
          if (!lastByEmployee.has(row.employee_id)) lastByEmployee.set(row.employee_id, row);
        }
        setRows(Array.from(lastByEmployee.values()).sort((a, b) => b.at_ms - a.at_ms));
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const onShiftNow = (rows ?? []).filter((r) => r.kind === "ENTRADA" || r.kind === "INTERVALO_FIM");

  return (
    <div className="m-shell">
      <div className="m-frame">
        <div className="m-navbar">
          <button type="button" className="m-round" aria-label="Voltar" onClick={onBack}>
            ‹
          </button>
          <span className="m-title-sm m-grow">Equipe hoje</span>
        </div>

        <div className="m-scroll">
          <p className="m-num" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, color: "#1D8273" }}>
            {rows === null ? "—" : onShiftNow.length}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>no turno agora, nas 3 unidades</p>

          <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Últimas marcações</p>
          <div className="m-stack" style={{ gap: 8 }}>
            {(rows ?? []).map((row) => {
              const st = pontoStatusLabel(row.kind);
              const brand = unitBrandFor(units.find((u) => u.id === row.unit_id)?.name ?? "");
              return (
                <div key={row.employee_id} className="m-card" style={{ borderRadius: 16, padding: "12px 14px" }}>
                  <div className="m-row" style={{ justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{row.full_name}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: st.color, flex: "none" }}>{st.label}</span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                    {brand.title} · {fmtTime(row.at_ms)}
                  </p>
                </div>
              );
            })}
            {rows !== null && rows.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Ninguém bateu ponto ainda hoje.</p>
            )}
            {rows === null && <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Carregando…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
