import { useEffect, useState } from "react";
import { Api } from "../api/client.js";
import type { Unit, ShiftSummary } from "../api/client.js";
import { unitBrandFor } from "../branding/unitBrand.js";
import { money } from "../format.js";

interface Divergence {
  unitId: string;
  totalCents: number;
  shiftClosedAtMs: number;
}

function sumJson(json: string | null): number {
  if (!json) return 0;
  try {
    const obj = JSON.parse(json) as Record<string, number>;
    return Object.values(obj).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Fechamento do dia — soma real das 3 unidades. "Meta %" do protótipo
 * ficou de fora (não existe no banco); a divergência de caixa por
 * unidade é a última conferência FECHADA de cada uma (fa_kiosk_shifts,
 * mesma leitura declared_json/expected_json que a tela de Caixa usa pra
 * mostrar "✓ bateu"/"⚠ diferença" na conferência).
 *
 * A quebra por forma de pagamento só cobre o turno ABERTO agora em cada
 * unidade (fa_kiosk_payments do shift atual) — turnos já fechados hoje
 * não entram nessa soma, por isso o rótulo diz "desde a abertura do
 * turno atual" em vez de "hoje".
 */
export function MobileRelatorios({ units, onBack }: { units: Unit[]; onBack: () => void }) {
  const [revenueByUnit, setRevenueByUnit] = useState<Record<string, number>>({});
  const [methodTotals, setMethodTotals] = useState<Record<string, number>>({});
  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (units.length === 0) return;
    let alive = true;
    setLoading(true);

    Promise.all(units.map((u) => Api.todayRevenue(u.id, u.business_day_cutoff_hour).then((r) => [u.id, r.totalCents] as const)))
      .then((pairs) => alive && setRevenueByUnit(Object.fromEntries(pairs)))
      .catch(() => {});

    Api.unitsCashStatus()
      .then(async (rows) => {
        const openShiftIds = rows.filter((r) => r.status === "ABERTO" && r.shift_id).map((r) => r.shift_id!);
        const byMethodLists = await Promise.all(openShiftIds.map((id) => Api.revenueByMethod(id).catch(() => [])));
        if (!alive) return;
        const totals: Record<string, number> = {};
        for (const list of byMethodLists) {
          for (const row of list) totals[row.method] = (totals[row.method] ?? 0) + row.total_cents;
        }
        setMethodTotals(totals);
      })
      .catch(() => {});

    Promise.all(
      units.map(async (u) => {
        const shifts: ShiftSummary[] = await Api.reportShifts(u.id).catch(() => []);
        const lastClosed = shifts.find((s) => s.status === "FECHADO" && s.closed_at_ms);
        if (!lastClosed) return null;
        const diff = sumJson(lastClosed.declared_json) - sumJson(lastClosed.expected_json);
        if (diff === 0) return null;
        return { unitId: u.id, totalCents: diff, shiftClosedAtMs: lastClosed.closed_at_ms! } as Divergence;
      }),
    )
      .then((rows) => alive && setDivergences(rows.filter((r): r is Divergence => r !== null)))
      .catch(() => {})
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [units]);

  const totalRevenueCents = Object.values(revenueByUnit).reduce((s, v) => s + v, 0);
  const hasRevenue = Object.keys(revenueByUnit).length > 0;

  return (
    <div className="m-shell">
      <div className="m-frame">
        <div className="m-navbar">
          <button type="button" className="m-round" aria-label="Voltar" onClick={onBack}>
            ‹
          </button>
          <span className="m-title-sm m-grow">Relatórios</span>
        </div>

        <div className="m-scroll">
          <p className="m-eyebrow">Receita das 3 unidades hoje</p>
          <p className="m-num" style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontSize: 30, color: "var(--color-primary-hover)" }}>
            {hasRevenue ? money(totalRevenueCents) : "—"}
          </p>

          {Object.keys(methodTotals).length > 0 && (
            <>
              <p className="m-eyebrow" style={{ margin: "18px 0 8px" }}>Por forma de pagamento · desde a abertura do turno atual</p>
              <div className="m-stack" style={{ gap: 6 }}>
                {Object.entries(methodTotals).map(([method, cents]) => (
                  <div key={method} className="m-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{method}</span>
                    <span className="m-num" style={{ fontSize: 13, fontWeight: 800 }}>{money(cents)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Por unidade</p>
          <div className="m-stack" style={{ gap: 8 }}>
            {units.map((u) => {
              const brand = unitBrandFor(u.name);
              const revenue = revenueByUnit[u.id];
              return (
                <div key={u.id} className="m-row" style={{ justifyContent: "space-between", background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 16, padding: "12px 14px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{brand.icon} {brand.title}</span>
                  <span className="m-num" style={{ fontSize: 14, fontWeight: 800 }}>{revenue != null ? money(revenue) : "—"}</span>
                </div>
              );
            })}
          </div>

          {divergences.length > 0 && (
            <>
              <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Precisa de atenção</p>
              <div className="m-stack" style={{ gap: 8 }}>
                {divergences.map((d) => {
                  const brand = unitBrandFor(units.find((u) => u.id === d.unitId)?.name ?? "");
                  return (
                    <div key={d.unitId} style={{ background: "rgba(232,48,48,.06)", border: "1px solid var(--color-error)", borderRadius: 16, padding: "12px 14px" }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--color-error-text, #E61E1E)" }}>
                        Diferença de {money(Math.abs(d.totalCents))} no caixa {d.totalCents < 0 ? "(faltou)" : "(sobrou)"} — {brand.title}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                        último fechamento, {new Date(d.shiftClosedAtMs).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {loading && (
            <p style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Carregando…</p>
          )}
        </div>
      </div>
    </div>
  );
}
