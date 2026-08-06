import { useEffect, useState } from "react";
import { Card, DateInput, Tabs, contrastRatio } from "@facaamigos/ui";
import { Api, businessDateFor } from "../api/client.js";
import type { AssetUsage, BirthdayChild, DailySales, DailyVisits, FolhaPontoRow, PlanSold, RevenueByMethod, ShiftSummary } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { AssetUsageChart, PlansSoldChart, RevenueByDayChart, RevenueByMethodChart, VisitsByDayChart } from "../components/charts/ReportCharts.js";

type Tab = "VENDAS" | "PLANOS" | "VISITAS" | "ANIVERSARIANTES" | "TURNOS" | "PONTO" | "FROTA";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function RelatorioScreen() {
  const { unit } = useAppState();
  const isQuiosque = unit?.kind === "QUIOSQUE";
  const [tab, setTab] = useState<Tab>("VENDAS");

  if (!unit) return null;

  const tabs: { value: Tab; label: string }[] = [
    { value: "VENDAS", label: "Vendas" },
    { value: "PLANOS", label: "Planos vendidos" },
    { value: "VISITAS", label: "Visitas" },
    { value: "ANIVERSARIANTES", label: "Crianças (aniversário)" },
    { value: "TURNOS", label: "Movimentação de Caixa" },
    { value: "PONTO", label: "Folha de Ponto" },
    ...(isQuiosque ? ([{ value: "FROTA", label: "Frota (mapa de calor)" }] as const) : []),
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Relatório</h1>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      <div role="tabpanel">
        {tab === "VENDAS" && <VendasTab unitId={unit.id} />}
        {tab === "PLANOS" && <PlanosTab unitId={unit.id} cutoffHour={unit.business_day_cutoff_hour} />}
        {tab === "VISITAS" && <VisitasTab unitId={unit.id} />}
        {tab === "ANIVERSARIANTES" && <AniversariantesTab />}
        {tab === "TURNOS" && <TurnosTab unitId={unit.id} />}
        {tab === "PONTO" && <PontoTab />}
        {tab === "FROTA" && isQuiosque && <FrotaHeatmapTab unitId={unit.id} />}
      </div>
    </div>
  );
}

function useDateRange() {
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  return { from, setFrom, to, setTo };
}

function VendasTab({ unitId }: { unitId: string }) {
  const { from, setFrom, to, setTo } = useDateRange();
  const [byDay, setByDay] = useState<DailySales[]>([]);
  const [byMethod, setByMethod] = useState<RevenueByMethod[]>([]);

  useEffect(() => {
    Api.reportSales(unitId, from, to).then((r) => {
      setByDay(r.byDay);
      setByMethod(r.byMethod);
    });
  }, [unitId, from, to]);

  const total = byMethod.reduce((sum, r) => sum + r.total_cents, 0);

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <Card style={{ padding: "16px", margin: "16px 0" }}>
        <h2>Total do período: {money(total)}</h2>
        {byMethod.map((r) => (
          <div key={r.method} style={{ display: "flex", justifyContent: "space-between" }}>
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
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tipos de plano × quantidade vendida, no dia e no mês.
 *
 * Os dois períodos aparecem juntos de propósito: a leitura útil não é
 * "quantos vendi hoje", e sim se a mistura de planos de hoje está fora do
 * padrão do mês — é isso que indica se vale mexer em preço ou duração.
 */
function PlanosTab({ unitId, cutoffHour }: { unitId: string; cutoffHour: number }) {
  const [today, setToday] = useState<PlanSold[]>([]);
  const [month, setMonth] = useState<PlanSold[]>([]);

  useEffect(() => {
    // Dia operacional da unidade (respeita o horário de corte), não a data
    // do relógio — é a mesma régua que o banco usa em business_date.
    const dayIso = businessDateFor(Date.now(), cutoffHour);
    const monthStartIso = `${dayIso.slice(0, 7)}-01`;
    Api.reportPlansSold(unitId, dayIso, dayIso).then(setToday);
    Api.reportPlansSold(unitId, monthStartIso, dayIso).then(setMonth);
  }, [unitId, cutoffHour]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <PlansSoldBlock title="Hoje" data={today} />
      <PlansSoldBlock title="No mês" data={month} />
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
          Nenhum plano vendido {title.toLowerCase()}.
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "16px" }}>
          <PlansSoldChart title={`Participação — ${title.toLowerCase()}`} data={data} />

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

function VisitasTab({ unitId }: { unitId: string }) {
  const { from, setFrom, to, setTo } = useDateRange();
  const [visits, setVisits] = useState<DailyVisits[]>([]);

  useEffect(() => {
    Api.reportVisits(unitId, from, to).then(setVisits);
  }, [unitId, from, to]);

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
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
        </tbody>
      </table>
    </div>
  );
}

function AniversariantesTab() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [children, setChildren] = useState<BirthdayChild[]>([]);

  useEffect(() => {
    Api.reportBirthdays(month).then(setChildren);
  }, [month]);

  const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <div>
      <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <ul style={{ marginTop: "16px" }}>
        {children.map((c) => (
          <li key={c.id}>
            {c.full_name} — {c.birth_date}
          </li>
        ))}
        {children.length === 0 && <li>Nenhum aniversariante neste mês.</li>}
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
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
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

/**
 * Pareia ENTRADA→SAIDA e INTERVALO_INICIO→INTERVALO_FIM por colaborador e
 * dia civil, no fuso do navegador (mesmo critério visual do "Marcações de
 * hoje" em PontoScreen). Marcação sem par (esqueceu de bater a saída, por
 * exemplo) não entra na soma — aparece só na tabela bruta abaixo, que
 * continua sendo o registro de auditoria de verdade.
 */
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

function PontoTab() {
  const { from, setFrom, to, setTo } = useDateRange();
  const [rows, setRows] = useState<FolhaPontoRow[]>([]);

  useEffect(() => {
    Api.reportPonto(new Date(from).getTime(), new Date(to).getTime() + 86_400_000).then(setRows);
  }, [from, to]);

  const dailySummaries = summarizeDailyHours(rows);

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

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

function FrotaHeatmapTab({ unitId }: { unitId: string }) {
  const { from, setFrom, to, setTo } = useDateRange();
  const [usage, setUsage] = useState<AssetUsage[]>([]);

  useEffect(() => {
    Api.reportAssetUsage(unitId, from, to).then(setUsage);
  }, [unitId, from, to]);

  const maxSessions = Math.max(1, ...usage.map((u) => u.sessions_count));

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "12px 0" }} title="Quanto mais escuro/intenso, mais o carrinho foi alocado no período — ajuda a identificar quais carrinhos se pagam mais rápido e quais ficam parados">
        Intensidade da cor = frequência de uso no período selecionado.
      </p>
      <div style={{ marginBottom: "16px" }}>
        <AssetUsageChart data={usage} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
        {usage.map((u) => {
          const intensity = u.sessions_count / maxSessions;
          const idle = u.sessions_count === 0;
          // A cor do carrinho é escolhida livremente em Configurações
          // (6 opções, algumas claras — ex. #FFE234) — texto branco fixo
          // por cima falhava contraste por construção pra qualquer cor
          // clara. Em vez de mais um hex fixo, escolhe em tempo real
          // qual dos dois (branco ou o escuro da marca) rende mais
          // contraste contra a cor real deste carrinho.
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

function DateRangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 150px", maxWidth: "200px" }}>
        <DateInput label="De" value={from} onChange={setFrom} />
      </div>
      <div style={{ flex: "1 1 150px", maxWidth: "200px" }}>
        <DateInput label="Até" value={to} onChange={setTo} />
      </div>
    </div>
  );
}
