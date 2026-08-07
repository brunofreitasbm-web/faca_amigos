import { useEffect, useState } from "react";
import { Card, DateInput, Tabs, contrastRatio, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { AssetUsage, BirthdayChild, DailySales, DailyVisits, FolhaPontoRow, PlanSold, RevenueByMethod, ShiftSummary } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { AssetUsageChart, PlansSoldChart, RevenueByDayChart, RevenueByMethodChart, VisitsByDayChart } from "../components/charts/ReportCharts.js";

type Tab = "VENDAS" | "PLANOS" | "VISITAS" | "ANIVERSARIANTES" | "TURNOS" | "PONTO" | "FROTA";
type PeriodPreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "this_month" | "last_month" | "this_year" | "last_year" | "custom";
type OriginFilter = "ALL" | "LOCAL" | "SAFOPLAY";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeDatesForPeriod(period: PeriodPreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (period === "today") {
    const todayStr = isoDate(now);
    return { from: todayStr, to: todayStr };
  }
  if (period === "yesterday") {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const yStr = isoDate(y);
    return { from: yStr, to: yStr };
  }
  if (period === "7d") {
    const from = new Date(now);
    from.setDate(now.getDate() - 7);
    return { from: isoDate(from), to: isoDate(now) };
  }
  if (period === "90d") {
    const from = new Date(now);
    from.setDate(now.getDate() - 90);
    return { from: isoDate(from), to: isoDate(now) };
  }
  if (period === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDate(from), to: isoDate(now) };
  }
  if (period === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (period === "this_year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from: isoDate(from), to: isoDate(now) };
  }
  if (period === "last_year") {
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear() - 1, 11, 31);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (period === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }
  // 30d default
  const from = new Date(now);
  from.setDate(now.getDate() - 30);
  return { from: isoDate(from), to: isoDate(now) };
}

export function RelatorioScreen() {
  const { unit } = useAppState();
  const isQuiosque = unit?.kind === "QUIOSQUE";
  const [tab, setTab] = useState<Tab>("VENDAS");

  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const [origin, setOrigin] = useState<OriginFilter>("ALL");
  const [customFrom, setCustomFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));

  if (!unit) return null;

  const { from, to } = computeDatesForPeriod(period, customFrom, customTo);

  const tabs: { value: Tab; label: string }[] = [
    { value: "VENDAS", label: "Vendas" },
    { value: "PLANOS", label: "Planos vendidos" },
    { value: "VISITAS", label: "Visitas" },
    { value: "ANIVERSARIANTES", label: "Crianças (aniversário)" },
    { value: "TURNOS", label: "Movimentação de Caixa" },
    { value: "PONTO", label: "Folha de Ponto" },
    ...(isQuiosque ? ([{ value: "FROTA", label: "Frota (mapa de calor)" }] as const) : []),
  ];

  const TAB_HELP: Record<Tab, string> = {
    VENDAS: "Quanto foi vendido em cada dia e por forma de pagamento, no período e origem escolhidos.",
    PLANOS: "Quantidade de cada plano vendido no período — incluindo dados importados do Safoplay quando selecionados.",
    VISITAS: "Quantas crianças entraram por dia no período e origem selecionados.",
    ANIVERSARIANTES: "Lista de crianças cadastradas que fazem aniversário no mês selecionado.",
    TURNOS: "Histórico de turnos de caixa abertos e fechados nesta unidade.",
    PONTO: "Horas trabalhadas por colaborador e o registro bruto de cada marcação de ponto no período.",
    FROTA: "Quais carrinhos foram mais e menos usados no período — ajuda a decidir manutenção e reposição.",
  };

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid var(--border-subtle, #e5e7eb)",
    background: "var(--surface-card, #fff)",
    color: "var(--text-primary, #111827)",
    fontSize: "14px",
    fontWeight: 500,
    outline: "none",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "950px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Relatórios Gerais</h1>
      <HelpText>Consulte o histórico de vendas, visitas, planos e movimentações — selecione o período e a origem dos dados (Local/Safoplay).</HelpText>

      {/* Barra Global de Filtros (Período e Origem) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "16px",
          padding: "16px",
          margin: "16px 0",
          borderRadius: "12px",
          background: "var(--surface-card, #fff)",
          border: "1px solid var(--border-subtle, #e5e7eb)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary, #6b7280)" }}>Período</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodPreset)} style={selectStyle}>
            <option value="today">Hoje (Dia)</option>
            <option value="yesterday">Ontem (Dia)</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="this_month">Este Mês</option>
            <option value="last_month">Mês Anterior</option>
            <option value="this_year">Este Ano</option>
            <option value="last_year">Ano Anterior</option>
            <option value="custom">Período Personalizado</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary, #6b7280)" }}>Origem dos Dados</label>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as OriginFilter)} style={selectStyle}>
            <option value="ALL">Todas as Origens (Local + Safoplay)</option>
            <option value="LOCAL">Somente Sistema Local</option>
            <option value="SAFOPLAY">Somente Safoplay (Importado)</option>
          </select>
        </div>

        {period === "custom" && (
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
            <div style={{ width: "150px" }}>
              <DateInput label="De" value={customFrom} onChange={setCustomFrom} />
            </div>
            <div style={{ width: "150px" }}>
              <DateInput label="Até" value={customTo} onChange={setCustomTo} />
            </div>
          </div>
        )}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <HelpText style={{ margin: "12px 0" }}>{TAB_HELP[tab]}</HelpText>

      <div role="tabpanel">
        {tab === "VENDAS" && <VendasTab unitId={unit.id} from={from} to={to} origin={origin} />}
        {tab === "PLANOS" && <PlanosTab unitId={unit.id} from={from} to={to} origin={origin} />}
        {tab === "VISITAS" && <VisitasTab unitId={unit.id} from={from} to={to} origin={origin} />}
        {tab === "ANIVERSARIANTES" && <AniversariantesTab origin={origin} />}
        {tab === "TURNOS" && <TurnosTab unitId={unit.id} />}
        {tab === "PONTO" && <PontoTab from={from} to={to} />}
        {tab === "FROTA" && isQuiosque && <FrotaHeatmapTab unitId={unit.id} from={from} to={to} origin={origin} />}
      </div>
    </div>
  );
}

function VendasTab({ unitId, from, to, origin }: { unitId: string; from: string; to: string; origin: OriginFilter }) {
  const [byDay, setByDay] = useState<DailySales[]>([]);
  const [byMethod, setByMethod] = useState<RevenueByMethod[]>([]);

  useEffect(() => {
    Api.reportSales(unitId, from, to, origin).then((r) => {
      setByDay(r.byDay);
      setByMethod(r.byMethod);
    });
  }, [unitId, from, to, origin]);

  const total = byMethod.reduce((sum, r) => sum + r.total_cents, 0);

  return (
    <div>
      <Card style={{ padding: "16px", margin: "16px 0" }}>
        <h2>Total do período: {money(total)}</h2>
        {byMethod.map((r) => (
          <div key={r.method} style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}>
            <span>{r.method}</span>
            <span>{money(r.total_cents)}</span>
          </div>
        ))}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "16px", marginBottom: "16px" }}>
        <RevenueByDayChart data={byDay} />
        <RevenueByMethodChart data={byMethod} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Dia</th>
            <th>Pedidos</th>
            <th>Faturamento</th>
          </tr>
        </thead>
        <tbody>
          {byDay.map((d) => (
            <tr key={d.business_date}>
              <td>{d.business_date}</td>
              <td style={{ textAlign: "center" }}>{d.orders_count}</td>
              <td style={{ textAlign: "right" }}>{money(d.total_cents)}</td>
            </tr>
          ))}
          {byDay.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                Nenhuma venda encontrada para os filtros selecionados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PlanosTab({ unitId, from, to, origin }: { unitId: string; from: string; to: string; origin: OriginFilter }) {
  const [plansSold, setPlansSold] = useState<PlanSold[]>([]);

  useEffect(() => {
    Api.reportPlansSold(unitId, from, to, origin).then(setPlansSold);
  }, [unitId, from, to, origin]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "16px" }}>
      <PlansSoldBlock title={`Período selecionado (${from} a ${to})`} data={plansSold} />
    </div>
  );
}

function PlansSoldBlock({ title, data }: { title: string; data: PlanSold[] }) {
  const total = data.reduce((sum, p) => sum + p.sessions_count, 0);

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: "0 0 12px 0" }}>
        {title} — {total} {total === 1 ? "venda" : "vendas"}
      </h2>

      {total === 0 ? (
        <Card style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
          Nenhum plano vendido no período e origem selecionados.
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "16px" }}>
          <PlansSoldChart title={`Participação — ${title}`} data={data} />

          <Card style={{ padding: "16px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Plano</th>
                  <th style={{ textAlign: "right" }}>Qtd.</th>
                  <th style={{ textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => {
                  const pct = (p.sessions_count / total) * 100;
                  return (
                    <tr key={p.plan_id}>
                      <td style={{ padding: "6px 0" }}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: "10px",
                            height: "10px",
                            borderRadius: "50%",
                            background: p.plan_color,
                            marginRight: "8px",
                          }}
                        />
                        {p.plan_name}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: "bold" }}>{p.sessions_count}</td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ paddingTop: "8px", color: "var(--text-secondary)" }}>Total</td>
                  <td style={{ textAlign: "right", paddingTop: "8px", fontWeight: "bold" }}>{total}</td>
                  <td style={{ textAlign: "right", paddingTop: "8px", color: "var(--text-secondary)" }}>100%</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

function VisitasTab({ unitId, from, to, origin }: { unitId: string; from: string; to: string; origin: OriginFilter }) {
  const [visits, setVisits] = useState<DailyVisits[]>([]);

  useEffect(() => {
    Api.reportVisits(unitId, from, to, origin).then(setVisits);
  }, [unitId, from, to, origin]);

  return (
    <div>
      <div style={{ margin: "16px 0" }}>
        <VisitsByDayChart data={visits} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Dia</th>
            <th>Visitas</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => (
            <tr key={v.business_date}>
              <td>{v.business_date}</td>
              <td style={{ textAlign: "center" }}>{v.sessions_count}</td>
            </tr>
          ))}
          {visits.length === 0 && (
            <tr>
              <td colSpan={2} style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                Nenhuma visita encontrada no período e origem selecionados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AniversariantesTab({ origin }: { origin: OriginFilter }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [children, setChildren] = useState<BirthdayChild[]>([]);

  useEffect(() => {
    Api.reportBirthdays(month, origin).then(setChildren);
  }, [month, origin]);

  const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <span style={{ fontSize: "14px", fontWeight: 600 }}>Mês:</span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            background: "var(--surface-card, #fff)",
            fontSize: "14px",
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {children.map((c) => (
          <li
            key={c.id}
            style={{
              padding: "10px 14px",
              marginBottom: "8px",
              background: "var(--surface-card, #fff)",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle, #e5e7eb)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <strong>{c.full_name}</strong>
            <span style={{ color: "var(--text-secondary)" }}>{c.birth_date}</span>
          </li>
        ))}
        {children.length === 0 && (
          <li style={{ color: "var(--text-muted)", textAlign: "center", padding: "16px" }}>
            Nenhum aniversariante encontrado neste mês.
          </li>
        )}
      </ul>
    </div>
  );
}

function TurnosTab({ unitId }: { unitId: string }) {
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);

  useEffect(() => {
    Api.reportShifts(unitId).then(setShifts);
  }, [unitId]);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Abertura</th>
          <th>Fechamento</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {shifts.map((s) => (
          <tr key={s.id}>
            <td>{new Date(s.opened_at_ms).toLocaleString("pt-BR")}</td>
            <td>{s.closed_at_ms ? new Date(s.closed_at_ms).toLocaleString("pt-BR") : "—"}</td>
            <td>{s.status}</td>
          </tr>
        ))}
        {shifts.length === 0 && (
          <tr>
            <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
              Nenhum turno registrado.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

interface DailyHoursSummary {
  employeeId: string;
  fullName: string;
  dateLabel: string;
  workedMs: number;
  targetMs: number | null;
}

function summarizeDailyHours(rows: FolhaPontoRow[]): DailyHoursSummary[] {
  const byGroup = new Map<string, FolhaPontoRow[]>();
  for (const r of rows) {
    const dateLabel = new Date(r.at_ms).toLocaleDateString("pt-BR");
    const key = `${r.employee_id}|${dateLabel}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }

  const summaries: DailyHoursSummary[] = [];
  for (const [key, group] of byGroup) {
    const [, dateLabel] = key.split("|") as [string, string];
    const sorted = [...group].sort((a, b) => a.at_ms - b.at_ms);
    let workedMs = 0;
    let entradaAt: number | null = null;
    let intervaloAt: number | null = null;
    for (const r of sorted) {
      if (r.kind === "ENTRADA") entradaAt = r.at_ms;
      else if (r.kind === "SAIDA" && entradaAt !== null) {
        workedMs += r.at_ms - entradaAt;
        entradaAt = null;
      } else if (r.kind === "INTERVALO_INICIO") intervaloAt = r.at_ms;
      else if (r.kind === "INTERVALO_FIM" && intervaloAt !== null) {
        workedMs -= r.at_ms - intervaloAt;
        intervaloAt = null;
      }
    }
    const first = sorted[0]!;
    summaries.push({
      employeeId: first.employee_id,
      fullName: first.full_name,
      dateLabel,
      workedMs: Math.max(0, workedMs),
      targetMs: first.weekly_hours_contracted ? (first.weekly_hours_contracted / 5) * 60 * 60 * 1000 : null,
    });
  }
  return summaries.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.dateLabel.localeCompare(b.dateLabel));
}

function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function PontoTab({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<FolhaPontoRow[]>([]);

  useEffect(() => {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime() + 86_400_000;
    Api.reportPonto(fromMs, toMs).then(setRows);
  }, [from, to]);

  const dailySummaries = summarizeDailyHours(rows);

  return (
    <div>
      <h3 style={{ marginTop: "20px" }}>Resumo de horas por colaborador/dia</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Colaborador</th>
            <th>Dia</th>
            <th>Horas trabalhadas</th>
            <th>Jornada contratada (dia)</th>
            <th>Diferença</th>
          </tr>
        </thead>
        <tbody>
          {dailySummaries.map((s) => {
            const diffMs = s.targetMs !== null ? s.workedMs - s.targetMs : null;
            return (
              <tr key={`${s.employeeId}|${s.dateLabel}`}>
                <td>{s.fullName}</td>
                <td style={{ textAlign: "center" }}>{s.dateLabel}</td>
                <td style={{ textAlign: "center" }}>{formatDurationMs(s.workedMs)}</td>
                <td style={{ textAlign: "center" }}>{s.targetMs !== null ? formatDurationMs(s.targetMs) : "—"}</td>
                <td
                  style={{
                    textAlign: "center",
                    color: diffMs === null ? undefined : diffMs < -15 * 60_000 ? "var(--color-error-text)" : diffMs > 15 * 60_000 ? "var(--color-amber)" : "var(--color-teal-text)",
                  }}
                >
                  {diffMs === null ? "—" : `${diffMs >= 0 ? "+" : "-"}${formatDurationMs(Math.abs(diffMs))}`}
                </td>
              </tr>
            );
          })}
          {dailySummaries.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                Nenhuma marcação no período.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Marcações (registro de auditoria)</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Colaborador</th>
            <th>Tipo</th>
            <th>Horário</th>
            <th>NSR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.full_name}</td>
              <td>{r.kind}</td>
              <td>{new Date(r.at_ms).toLocaleString("pt-BR")}</td>
              <td style={{ textAlign: "center" }}>{r.nsr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FrotaHeatmapTab({ unitId, from, to, origin }: { unitId: string; from: string; to: string; origin: OriginFilter }) {
  const [usage, setUsage] = useState<AssetUsage[]>([]);

  useEffect(() => {
    Api.reportAssetUsage(unitId, from, to, origin).then(setUsage);
  }, [unitId, from, to, origin]);

  const maxSessions = Math.max(1, ...usage.map((u) => u.sessions_count));

  return (
    <div style={{ marginTop: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "12px 0" }} title="Quanto mais escuro/intenso, mais o carrinho foi alocado no período">
        Intensidade da cor = frequência de uso no período e origem selecionados.
      </p>
      <div style={{ marginBottom: "16px" }}>
        <AssetUsageChart data={usage} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
        {usage.map((u) => {
          const intensity = u.sessions_count / maxSessions;
          const idle = u.sessions_count === 0;
          const textColor =
            !idle && contrastRatio("#1A3F35", u.color) > contrastRatio("#FFFFFF", u.color) ? "#1A3F35" : "#fff";
          return (
            <Card
              key={u.id}
              title={`${u.sessions_count} uso(s) — ${Math.round(u.total_minutes / 60)}h de uso no período`}
              style={{
                padding: "16px",
                textAlign: "center",
                opacity: idle ? 0.35 : 0.4 + intensity * 0.6,
                background: idle ? "var(--surface-card)" : u.color,
                color: idle ? "var(--text-primary)" : textColor,
              }}
            >
              <div style={{ fontSize: "28px" }}>{u.emoji}</div>
              <strong>{u.name}</strong>
              <div style={{ fontSize: "13px" }}>{u.sessions_count} usos</div>
              <div style={{ fontSize: "12px" }}>{Math.round(u.total_minutes / 60)}h no período</div>
              {idle && <div style={{ fontSize: "12px", fontWeight: "bold" }}>⏸️ parado</div>}
            </Card>
          );
        })}
        {usage.length === 0 && <p>Nenhum carrinho cadastrado para esta unidade.</p>}
      </div>
    </div>
  );
}
