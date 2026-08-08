import { useEffect, useMemo, useState } from "react";
import { Card, HelpText } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { CashMovement, UnitShiftRow } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

interface FlowNode {
  key: string;
  label: string;
  sublabel: string;
  amountCents: number;
  kind: "in" | "out" | "balance";
  photoUrl?: string | null;
}

const COLOR = {
  in: "var(--color-teal)",
  out: "var(--color-warning)",
  balance: "var(--color-primary)",
} as const;

const CHART_HEIGHT = 420;
const TOP_PAD = 16;
const NODE_GAP = 8;
const NODE_WIDTH = 160;
const COL_LEFT_X = 8;
const COL_CENTER_X = 380;
const COL_CENTER_WIDTH = 90;
const COL_RIGHT_X = 712;
const SVG_WIDTH = 880;

function stack(nodes: FlowNode[], scale: number): Array<FlowNode & { y0: number; y1: number }> {
  let y = TOP_PAD;
  return nodes
    .filter((n) => n.amountCents > 0)
    .map((n) => {
      const h = n.amountCents * scale;
      const row = { ...n, y0: y, y1: y + h };
      y += h + NODE_GAP;
      return row;
    });
}

function ribbon(x0: number, y0top: number, y0bot: number, x1: number, y1top: number, y1bot: number): string {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0top} C${mid},${y0top} ${mid},${y1top} ${x1},${y1top} L${x1},${y1bot} C${mid},${y1bot} ${mid},${y0bot} ${x0},${y0bot} Z`;
}

export function HistoricoTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>(units[0]?.id ?? "");
  const [shifts, setShifts] = useState<UnitShiftRow[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [vendasDinheiroCents, setVendasDinheiroCents] = useState(0);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedUnit) return;
    (async () => {
      const [rows, employees] = await Promise.all([Api.unitShifts(selectedUnit), Api.employees()]);
      setShifts(rows);
      setEmployeeNames(Object.fromEntries(employees.map((e) => [e.id, e.full_name])));
      const openShift = rows.find((s) => s.status === "ABERTO");
      setSelectedShiftId(openShift?.id ?? rows[0]?.id ?? "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit]);

  useEffect(() => {
    if (!selectedShiftId) {
      setMovements([]);
      setVendasDinheiroCents(0);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [movs, revenue] = await Promise.all([Api.cashMovements(selectedShiftId), Api.revenueByMethod(selectedShiftId)]);
        setMovements(movs);
        setVendasDinheiroCents(revenue.find((r) => r.method === "DINHEIRO")?.total_cents ?? 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedShiftId]);

  const shift = shifts.find((s) => s.id === selectedShiftId);

  const { inflows, outflows, totalCents } = useMemo(() => {
    const openingCents = shift?.opening_cash_cents ?? 0;
    const suprimentos = movements.filter((m) => m.kind === "SUPRIMENTO");
    const sangrias = movements.filter((m) => m.kind === "SANGRIA");
    const ajustePos = movements.filter((m) => m.kind === "AJUSTE" && m.amount_cents > 0);
    const ajusteNeg = movements.filter((m) => m.kind === "AJUSTE" && m.amount_cents < 0);

    const ins: FlowNode[] = [
      { key: "troco", label: "Troco Inicial", sublabel: "Abertura do turno", amountCents: openingCents, kind: "in" },
      { key: "vendas", label: "Vendas em Dinheiro", sublabel: "Recebido no turno", amountCents: vendasDinheiroCents, kind: "in" },
      ...suprimentos.map((m) => ({
        key: `sup-${m.id}`,
        label: "Suprimento",
        sublabel: m.reason ?? employeeNames[m.employee_id] ?? "",
        amountCents: m.amount_cents,
        kind: "in" as const,
      })),
      ...ajustePos.map((m) => ({
        key: `adjp-${m.id}`,
        label: "Ajuste (+)",
        sublabel: m.reason ?? "",
        amountCents: m.amount_cents,
        kind: "in" as const,
      })),
    ];

    const outs: FlowNode[] = [
      ...sangrias.map((m) => ({
        key: `sang-${m.id}`,
        label: m.envelope_number ? `✉️ Envelope #${m.envelope_number}` : "Sangria",
        sublabel: `${employeeNames[m.employee_id] ?? "—"} · ${new Date(m.at_ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
        amountCents: m.amount_cents,
        kind: "out" as const,
        photoUrl: m.photo_url,
      })),
      ...ajusteNeg.map((m) => ({
        key: `adjn-${m.id}`,
        label: "Ajuste (−)",
        sublabel: m.reason ?? "",
        amountCents: Math.abs(m.amount_cents),
        kind: "out" as const,
      })),
    ];

    const totalIn = ins.reduce((s, n) => s + n.amountCents, 0);
    const totalOutMovs = outs.reduce((s, n) => s + n.amountCents, 0);
    const saldo = totalIn - totalOutMovs;
    outs.push({
      key: "saldo",
      label: shift?.status === "ABERTO" ? "Saldo Atual (na gaveta)" : "Saldo no Fechamento",
      sublabel: shift?.status === "ABERTO" ? "Ainda na loja" : "Turno encerrado",
      amountCents: Math.max(0, saldo),
      kind: "balance",
    });

    return { inflows: ins, outflows: outs, totalCents: Math.max(totalIn, totalIn) };
  }, [movements, vendasDinheiroCents, shift, employeeNames]);

  const scale = totalCents > 0 ? (CHART_HEIGHT - TOP_PAD * 2) / totalCents : 0;
  const leftStacked = stack(inflows, scale);
  const rightStacked = stack(outflows, scale);
  const centerBottom = Math.max(
    leftStacked.at(-1)?.y1 ?? TOP_PAD,
    rightStacked.at(-1)?.y1 ?? TOP_PAD,
  );

  return (
    <div>
      {zoomPhoto && (
        <div
          onClick={() => setZoomPhoto(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, cursor: "zoom-out" }}
        >
          <img src={zoomPhoto} alt="Foto do envelope" style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "12px" }} />
        </div>
      )}

      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>🔀 Histórico — Fluxo de Dinheiro</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          De onde o dinheiro do turno veio (troco, vendas, suprimentos) e para onde foi (sangrias/envelopes, ajustes, saldo que ficou na gaveta).
        </HelpText>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Loja</label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)", height: "38px" }}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Turno</label>
            <select
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)", height: "38px", minWidth: "260px" }}
            >
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.status === "ABERTO" ? "🟢 Aberto" : "⚪ Fechado"} — {new Date(s.opened_at_ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card style={{ padding: "20px" }}>
        {!shift || totalCents === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>{loading ? "Carregando…" : "Sem movimentação registrada neste turno."}</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: "20px", marginBottom: "12px", fontSize: "13px", flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: COLOR.in, marginRight: "6px" }} />Entradas</span>
              <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: COLOR.out, marginRight: "6px" }} />Saídas</span>
              <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: COLOR.balance, marginRight: "6px" }} />Saldo</span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <svg width={SVG_WIDTH} height={centerBottom + TOP_PAD} style={{ minWidth: "720px" }}>
                {/* Ribbons: entrada -> caixa central */}
                {leftStacked.map((n) => (
                  <path key={`r-${n.key}`} d={ribbon(COL_LEFT_X + NODE_WIDTH, n.y0, n.y1, COL_CENTER_X, n.y0, n.y1)} fill={COLOR.in} opacity={0.28}>
                    <title>{`${n.label}: ${money(n.amountCents)}`}</title>
                  </path>
                ))}
                {/* Ribbons: caixa central -> saída */}
                {rightStacked.map((n) => (
                  <path key={`r-${n.key}`} d={ribbon(COL_CENTER_X + COL_CENTER_WIDTH, n.y0, n.y1, COL_RIGHT_X, n.y0, n.y1)} fill={COLOR[n.kind]} opacity={0.28}>
                    <title>{`${n.label}: ${money(n.amountCents)}`}</title>
                  </path>
                ))}

                {/* Nó central: Caixa da Loja */}
                <rect x={COL_CENTER_X} y={TOP_PAD} width={COL_CENTER_WIDTH} height={centerBottom - TOP_PAD} rx={6} fill="var(--color-primary)" opacity={0.16} stroke="var(--color-primary)" strokeWidth={2} />
                <text x={COL_CENTER_X + COL_CENTER_WIDTH / 2} y={(centerBottom + TOP_PAD) / 2 - 6} textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--text-primary)">
                  Caixa da
                </text>
                <text x={COL_CENTER_X + COL_CENTER_WIDTH / 2} y={(centerBottom + TOP_PAD) / 2 + 10} textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--text-primary)">
                  Loja
                </text>
                <text x={COL_CENTER_X + COL_CENTER_WIDTH / 2} y={(centerBottom + TOP_PAD) / 2 + 28} textAnchor="middle" fontSize="12" fill="var(--text-secondary)">
                  {money(totalCents)}
                </text>

                {/* Nós de entrada (esquerda) */}
                {leftStacked.map((n) => (
                  <g key={n.key}>
                    <rect x={COL_LEFT_X} y={n.y0} width={NODE_WIDTH} height={Math.max(2, n.y1 - n.y0)} rx={4} fill={COLOR.in}>
                      <title>{`${n.label}: ${money(n.amountCents)}`}</title>
                    </rect>
                    <text x={COL_LEFT_X} y={n.y0 - 4} fontSize="12" fontWeight="bold" fill="var(--text-primary)">
                      {n.label}
                    </text>
                    <text x={COL_LEFT_X} y={n.y1 + 12} fontSize="11" fill="var(--text-secondary)">
                      {money(n.amountCents)}
                    </text>
                  </g>
                ))}

                {/* Nós de saída (direita) */}
                {rightStacked.map((n) => (
                  <g key={n.key} onClick={() => n.photoUrl && setZoomPhoto(n.photoUrl)} style={{ cursor: n.photoUrl ? "zoom-in" : "default" }}>
                    <rect x={COL_RIGHT_X} y={n.y0} width={NODE_WIDTH} height={Math.max(2, n.y1 - n.y0)} rx={4} fill={COLOR[n.kind]}>
                      <title>{`${n.label}${n.sublabel ? ` — ${n.sublabel}` : ""}: ${money(n.amountCents)}${n.photoUrl ? " (clique para ver a foto)" : ""}`}</title>
                    </rect>
                    <text x={COL_RIGHT_X} y={n.y0 - 4} fontSize="12" fontWeight="bold" fill="var(--text-primary)">
                      {n.label}
                      {n.photoUrl ? " 📷" : ""}
                    </text>
                    <text x={COL_RIGHT_X} y={n.y1 + 12} fontSize="11" fill="var(--text-secondary)">
                      {money(n.amountCents)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </>
        )}
      </Card>

      {(inflows.some((n) => n.amountCents > 0) || outflows.some((n) => n.amountCents > 0)) && (
        <Card style={{ padding: "20px", marginTop: "16px" }}>
          <h3 style={{ fontSize: "16px", marginTop: 0 }}>Tabela de conferência</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Direção</th>
                <th style={{ padding: "8px" }}>Origem / Destino</th>
                <th style={{ padding: "8px" }}>Detalhe</th>
                <th style={{ padding: "8px", textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {[...inflows, ...outflows]
                .filter((n) => n.amountCents > 0)
                .map((n) => (
                  <tr key={n.key} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "8px" }}>{n.kind === "in" ? "⬇️ Entrada" : n.kind === "out" ? "⬆️ Saída" : "🔵 Saldo"}</td>
                    <td style={{ padding: "8px" }}>{n.label}</td>
                    <td style={{ padding: "8px", color: "var(--text-secondary)" }}>{n.sublabel}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: "bold" }}>{money(n.amountCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
