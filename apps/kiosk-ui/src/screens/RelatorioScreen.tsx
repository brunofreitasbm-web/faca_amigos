import { useEffect, useState } from "react";
import { Button, Card } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { AssetUsage, BirthdayChild, DailySales, DailyVisits, FolhaPontoRow, RevenueByMethod, ShiftSummary } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { AssetUsageChart, RevenueByDayChart, RevenueByMethodChart, VisitsByDayChart } from "../components/charts/ReportCharts.js";

type Tab = "VENDAS" | "VISITAS" | "ANIVERSARIANTES" | "TURNOS" | "PONTO" | "FROTA";

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
    { value: "VISITAS", label: "Visitas" },
    { value: "ANIVERSARIANTES", label: "Crianças (aniversário)" },
    { value: "TURNOS", label: "Movimentação de Caixa" },
    { value: "PONTO", label: "Folha de Ponto" },
    ...(isQuiosque ? ([{ value: "FROTA", label: "Frota (mapa de calor)" }] as const) : []),
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Relatório — {unit.name}</h1>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "16px 0" }}>
        {tabs.map((t) => (
          <Button key={t.value} variant={tab === t.value ? "primary" : "ghost"} size="sm" onClick={() => setTab(t.value)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "VENDAS" && <VendasTab unitId={unit.id} />}
      {tab === "VISITAS" && <VisitasTab unitId={unit.id} />}
      {tab === "ANIVERSARIANTES" && <AniversariantesTab />}
      {tab === "TURNOS" && <TurnosTab unitId={unit.id} />}
      {tab === "PONTO" && <PontoTab />}
      {tab === "FROTA" && isQuiosque && <FrotaHeatmapTab unitId={unit.id} />}
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "16px" }}>
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

function PontoTab() {
  const { from, setFrom, to, setTo } = useDateRange();
  const [rows, setRows] = useState<FolhaPontoRow[]>([]);

  useEffect(() => {
    Api.reportPonto(new Date(from).getTime(), new Date(to).getTime() + 86_400_000).then(setRows);
  }, [from, to]);

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
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
          return (
            <Card
              key={u.id}
              title={`${u.sessions_count} uso(s) — ${Math.round(u.total_minutes / 60)}h de uso no período`}
              style={{
                padding: "16px",
                textAlign: "center",
                opacity: idle ? 0.35 : 0.4 + intensity * 0.6,
                background: idle ? "var(--surface-card)" : u.color,
                color: idle ? "var(--text-primary)" : "#fff",
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
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <label>
        De: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        Até: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </div>
  );
}
