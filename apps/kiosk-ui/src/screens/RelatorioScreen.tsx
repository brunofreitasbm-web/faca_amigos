import { useEffect, useMemo, useState } from "react";
import { Card, DateInput, Input, Select, Tabs, contrastRatio, HelpText, Button, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { AssetUsage, BirthdayChild, CheckinsByHour, DailySales, DailyVisits, FolhaPontoRow, PlanSold, RevenueByMethod, SessionAudit, ShiftSummary } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { IfCan } from "../auth/RequireCapability.js";
import { EmployeeAuthGate } from "../components/EmployeeAuthGate.js";
import { money } from "../format.js";
import { formatCpf, formatPhoneBr } from "@facaamigos/domain";
import { AssetUsageChart, CheckinsByHourChart, PlansSoldChart, RevenueByDayChart, RevenueByMethodChart, VisitsByDayChart } from "../components/charts/ReportCharts.js";
import { exportFrequenciaCsv } from "../lib/csvExport.js";

type Tab = "VENDAS" | "PLANOS" | "VISITAS" | "CHECKINS_HORA" | "SESSOES" | "ANIVERSARIANTES" | "TURNOS" | "PONTO" | "FROTA";
export type PeriodPreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "this_month" | "last_month" | "this_year" | "last_year" | "custom";

// Data corrida em UTC (só usada para presets de N dias corridos, onde o
// eventual desvio de fuso de +/-1 dia na borda do intervalo não importa).
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Mesma regra usada no banco por `fa_kiosk_business_date` (ver migração
// 20260830000003): converte o instante para o horário de Belém (UTC-3, sem
// horário de verão) e só então aplica o corte do "dia" — para que "Hoje" e
// "Ontem" no relatório caiam exatamente no mesmo `business_date` que os
// pedidos gravados no banco, em vez de usar a data corrida em UTC (que troca
// de dia às 21h/00h em Belém, fora de sincronia com o corte real).
const BELEM_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;
export function businessDate(d: Date, cutoffHour: number): string {
  const shifted = new Date(d.getTime() + BELEM_UTC_OFFSET_MS - cutoffHour * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function computeDatesForPeriod(
  period: PeriodPreset,
  customFrom: string,
  customTo: string,
  cutoffHour = 4,
): { from: string; to: string } {
  const now = new Date();
  if (period === "today") {
    const todayStr = businessDate(now, cutoffHour);
    return { from: todayStr, to: todayStr };
  }
  if (period === "yesterday") {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const yStr = businessDate(y, cutoffHour);
    return { from: yStr, to: yStr };
  }
  if (period === "7d") {
    const from = new Date(now);
    from.setDate(now.getDate() - 7);
    return { from: businessDate(from, cutoffHour), to: businessDate(now, cutoffHour) };
  }
  if (period === "90d") {
    const from = new Date(now);
    from.setDate(now.getDate() - 90);
    return { from: businessDate(from, cutoffHour), to: businessDate(now, cutoffHour) };
  }
  if (period === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDate(from), to: businessDate(now, cutoffHour) };
  }
  if (period === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (period === "this_year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from: isoDate(from), to: businessDate(now, cutoffHour) };
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
  return { from: businessDate(from, cutoffHour), to: businessDate(now, cutoffHour) };
}

export function RelatorioScreen() {
  const { unit } = useAppState();
  const isQuiosque = unit?.kind === "QUIOSQUE";
  const [tab, setTab] = useState<Tab>("VENDAS");

  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));

  if (!unit) return null;

  const { from, to } = computeDatesForPeriod(period, customFrom, customTo, unit.business_day_cutoff_hour);

  const tabs: { value: Tab; label: string }[] = [
    { value: "VENDAS", label: "Vendas" },
    { value: "PLANOS", label: "Planos vendidos" },
    { value: "VISITAS", label: "Visitas" },
    { value: "CHECKINS_HORA", label: "Check-ins por hora" },
    { value: "SESSOES", label: "Sessões (auditoria)" },
    { value: "ANIVERSARIANTES", label: "Crianças (aniversário)" },
    { value: "TURNOS", label: "Movimentação de Caixa" },
    { value: "PONTO", label: "Folha de Ponto" },
    ...(isQuiosque ? ([{ value: "FROTA", label: "Frota (mapa de calor)" }] as const) : []),
  ];

  const TAB_HELP: Record<Tab, string> = {
    VENDAS: "Quanto foi vendido em cada dia e por forma de pagamento, no período e origem escolhidos.",
    PLANOS: "Quantidade de cada plano vendido no período — incluindo dados importados do Safoplay quando selecionados.",
    VISITAS: "Quantas crianças entraram por dia no período e origem selecionados.",
    CHECKINS_HORA: "Em que horário do dia as crianças mais chegam — ajuda a planejar escala de operadores.",
    SESSOES: "Registro de cada entrada individual — horário, criança, responsável que acompanhou e quem atendeu no balcão. Para consulta e rastreio posterior, inclusive para fins jurídicos.",
    ANIVERSARIANTES: "Lista de crianças cadastradas que fazem aniversário no mês selecionado.",
    TURNOS: "Histórico de turnos de caixa abertos e fechados nesta unidade.",
    PONTO: "Horas trabalhadas por colaborador e o registro bruto de cada marcação de ponto no período.",
    FROTA: "Quais carrinhos foram mais e menos usados no período — ajuda a decidir manutenção e reposição.",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "950px", margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Relatórios Gerais</h1>
      <HelpText>Consulte o histórico de vendas, visitas, planos e movimentações — selecione o período e a origem dos dados (Local/Safoplay).</HelpText>

      {/* Barra Global de Filtros (Período e Origem) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "16px",
          padding: "16px",
          margin: "16px 0",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ width: "220px" }}>
          <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value as PeriodPreset)}>
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
          </Select>
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
        {tab === "VENDAS" && <VendasTab unitId={unit.id} from={from} to={to} />}
        {tab === "PLANOS" && <PlanosVendidosTab unitId={unit.id} from={from} to={to} />}
        {tab === "VISITAS" && <VisitasTab unitId={unit.id} from={from} to={to} />}
        {tab === "CHECKINS_HORA" && <CheckinsPorHoraTab unitId={unit.id} from={from} to={to} />}
        {tab === "SESSOES" && <SessoesTab unitId={unit.id} from={from} to={to} />}
        {tab === "ANIVERSARIANTES" && <AniversariantesTab />}
        {tab === "TURNOS" && <TurnosTab unitId={unit.id} />}
        {tab === "PONTO" && <PontoTab from={from} to={to} />}
        {tab === "FROTA" && isQuiosque && <FrotaHeatmapTab unitId={unit.id} from={from} to={to} />}
      </div>
    </div>
  );
}

export function VendasTab({ unitId, from, to }: { unitId: string | null; from: string; to: string }) {
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
      <Card style={{ padding: "16px", margin: "16px 0" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px" }}>Total do período: {money(total)}</h2>
        {byMethod.map((r) => (
          <div key={r.method} style={{ display: "flex", justifyContent: "space-between", margin: "4px 0", fontSize: "14px" }}>
            <span style={{ color: "var(--text-secondary)" }}>{r.method}</span>
            <strong>{money(r.total_cents)}</strong>
          </div>
        ))}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "16px", marginBottom: "16px" }}>
        <RevenueByDayChart data={byDay} />
        <RevenueByMethodChart data={byMethod} />
      </div>
      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Dia</th>
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
                <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhuma venda encontrada para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function PlanosVendidosTab({ unitId, from, to }: { unitId: string | null; from: string; to: string }) {
  const [plansSold, setPlansSold] = useState<PlanSold[]>([]);

  useEffect(() => {
    Api.reportPlansSold(unitId, from, to).then(setPlansSold);
  }, [unitId, from, to]);

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

          <Card style={{ padding: "8px", overflowX: "auto" }}>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th style={{ textAlign: "right" }}>Qtd.</th>
                  <th style={{ textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => {
                  const pct = (p.sessions_count / total) * 100;
                  return (
                    <tr key={p.plan_id}>
                      <td>
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
                <tr>
                  <td style={{ color: "var(--text-secondary)", fontWeight: "var(--weight-bold)" as unknown as number }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: "bold" }}>{total}</td>
                  <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>100%</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

export function VisitasTab({ unitId, from, to }: { unitId: string | null; from: string; to: string }) {
  const [visits, setVisits] = useState<DailyVisits[]>([]);

  useEffect(() => {
    Api.reportVisits(unitId, from, to).then(setVisits);
  }, [unitId, from, to]);

  return (
    <div>
      <div style={{ margin: "16px 0" }}>
        <VisitsByDayChart data={visits} />
      </div>
      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Dia</th>
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
                <td colSpan={2} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhuma visita encontrada no período e origem selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  ATIVA: "No parque",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  FINALIZADA: "Finalizada",
};

export function SessoesTab({ unitId, from, to }: { unitId: string | null; from: string; to: string }) {
  const { units } = useAppState();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionAudit[]>([]);
  const [search, setSearch] = useState("");
  // Cancelar sessão é exceção rara e não-rotineira (aceite por engano,
  // duplicidade) — por isso pede reconfirmação de identidade por PIN
  // mesmo com o Líder/Owner já logado, com uma janela curta de tolerância
  // (ver EmployeeAuthGate/ttlMs) para não pedir de novo a cada cancelamento
  // seguido dentro do mesmo atendimento.
  const [cancelingFor, setCancelingFor] = useState<SessionAudit | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const STEP_UP_TTL_MS = 5 * 60_000;

  function refetchSessions() {
    Api.reportSessions(unitId, from, to).then(setSessions);
  }

  useEffect(() => {
    refetchSessions();
  }, [unitId, from, to]);

  async function doCancelSession() {
    if (!cancelingFor) return;
    const sessionId = cancelingFor.id;
    setCancelBusy(true);
    try {
      await Api.cancelSession(sessionId);
      toast.success("Sessão cancelada.");
      setCancelingFor(null);
      refetchSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível cancelar a sessão.");
    } finally {
      setCancelBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sessions;
    const digits = term.replace(/\D/g, "");
    return sessions.filter((s) => {
      if (s.id.toLowerCase().includes(term)) return true;
      if (s.access_code?.toLowerCase().includes(term)) return true;
      if (s.child_name.toLowerCase().includes(term)) return true;
      if (s.guardian_name.toLowerCase().includes(term)) return true;
      if (digits.length >= 3) {
        if (s.guardian_cpf?.includes(digits)) return true;
        if (s.guardian_phone?.includes(digits)) return true;
      }
      return false;
    });
  }, [sessions, search]);

  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ maxWidth: "420px", marginBottom: "16px" }}>
        <Input
          label="Buscar por ID da sessão, código, criança, responsável, CPF ou telefone"
          placeholder="Ex.: id da sessão, Helena, 91982501215"
          value={search}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>ID da sessão</th>
              {unitId === null && <th>Unidade</th>}
              <th>Criança</th>
              <th>Responsável</th>
              <th>Contato</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Status</th>
              <th>Atendido por</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-muted)", userSelect: "all" }} title="Identificador estável da sessão — use para rastreio posterior">
                  {s.id}
                </td>
                {unitId === null && <td style={{ fontSize: "12px" }}>{units.find((u) => u.id === s.unit_id)?.name ?? "—"}</td>}
                <td>{s.child_name}</td>
                <td>{s.guardian_name}</td>
                <td style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  {s.guardian_phone ? formatPhoneBr(s.guardian_phone) : "—"}
                  {s.guardian_cpf ? ` · ${formatCpf(s.guardian_cpf)}` : ""}
                </td>
                <td>{new Date(s.checkin_at_ms).toLocaleString("pt-BR")}</td>
                <td>{s.checkout_at_ms ? new Date(s.checkout_at_ms).toLocaleString("pt-BR") : "—"}</td>
                <td>
                  {SESSION_STATUS_LABEL[s.status] ?? s.status}
                  {s.legacy_source && (
                    <span
                      style={{
                        marginLeft: "6px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "10px",
                        fontWeight: 600,
                        backgroundColor: "rgba(99, 102, 241, 0.12)",
                        color: "#6366F1",
                        border: "1px solid rgba(99, 102, 241, 0.25)"
                      }}
                      title="Sessão importada do histórico de vendas legacy (sales.csv)"
                    >
                      Legado
                    </span>
                  )}
                </td>
                <td>{s.employee_name ?? "—"}</td>
                <td>
                  {s.status === "ATIVA" && (
                    <IfCan capability="sessao.cancel">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Cancelar esta sessão sem cobrar (aceite por engano, duplicidade)"
                        onClick={() => setCancelingFor(s)}
                      >
                        ❌ Cancelar
                      </Button>
                    </IfCan>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={unitId === null ? 10 : 9} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  {sessions.length === 0
                    ? "Nenhuma sessão encontrada no período e origem selecionados."
                    : "Nenhuma sessão corresponde à busca."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {cancelingFor && (
        <Modal onClose={() => !cancelBusy && setCancelingFor(null)} ariaLabel="Cancelar sessão" maxWidth="420px">
          {cancelBusy ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Cancelando…</p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
                Para cancelar a sessão de <strong>{cancelingFor.child_name}</strong> sem cobrar,
                confirme sua identidade com o PIN.
              </p>
              <EmployeeAuthGate
                requireCapability="sessao.cancel"
                ttlMs={STEP_UP_TTL_MS}
                onAuthenticated={() => void doCancelSession()}
                onCancel={() => setCancelingFor(null)}
              />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function AniversariantesTab() {
  const today = new Date();
  const currentDay = today.getUTCDate();
  const currentMonth = today.getUTCMonth() + 1;

  const [mode, setMode] = useState<"today" | "month">("today");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [children, setChildren] = useState<BirthdayChild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (mode === "today") {
      Api.reportBirthdays(currentMonth, currentDay)
        .then(setChildren)
        .finally(() => setLoading(false));
    } else {
      Api.reportBirthdays(selectedMonth)
        .then(setChildren)
        .finally(() => setLoading(false));
    }
  }, [mode, selectedMonth, currentMonth, currentDay]);

  const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  const formattedTodayDate = `${String(currentDay).padStart(2, "0")}/${String(currentMonth).padStart(2, "0")}/${today.getFullYear()}`;

  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
            🎂 Aniversariantes do Dia
            {mode === "today" && (
              <span style={{ fontSize: "12px", fontWeight: "normal", padding: "2px 8px", borderRadius: "12px", background: "rgba(245, 158, 11, 0.15)", color: "#D97706", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
                Hoje ({formattedTodayDate})
              </span>
            )}
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
            {mode === "today"
              ? `Crianças registradas que fazem aniversário hoje (${formattedTodayDate})`
              : `Crianças cadastradas que fazem aniversário no mês de ${MONTHS[selectedMonth - 1]}`}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", background: "var(--bg-card)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
            <button
              type="button"
              onClick={() => setMode("today")}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "none",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                background: mode === "today" ? "var(--primary-color, #4F46E5)" : "transparent",
                color: mode === "today" ? "#FFFFFF" : "var(--text-secondary)",
                transition: "all 0.2s"
              }}
            >
              🎂 Hoje ({currentDay}/{currentMonth})
            </button>
            <button
              type="button"
              onClick={() => setMode("month")}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "none",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                background: mode === "month" ? "var(--primary-color, #4F46E5)" : "transparent",
                color: mode === "month" ? "#FFFFFF" : "var(--text-secondary)",
                transition: "all 0.2s"
              }}
            >
              📅 Ver Mês
            </button>
          </div>

          {mode === "month" && (
            <div style={{ width: "160px" }}>
              <Select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <Card style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
          Carregando aniversariantes...
        </Card>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
          {children.map((c) => {
            const birthDt = new Date(c.birth_date);
            const age = today.getFullYear() - birthDt.getFullYear();

            return (
              <Card key={c.id} style={{ padding: "14px 18px", borderLeft: "4px solid #F59E0B" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "16px", color: "var(--text-main)" }}>{c.full_name}</strong>
                      <span style={{ fontSize: "12px", background: "#FEF3C7", color: "#B45309", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
                        {age > 0 ? `Completando ${age} ano${age > 1 ? "s" : ""} 🎉` : "Novo Bebê 🎈"}
                      </span>
                    </div>

                    <div style={{ marginTop: "4px", fontSize: "13px", color: "var(--text-secondary)", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      {c.guardian_name && <span>Responsável: <strong>{c.guardian_name}</strong></span>}
                      {c.guardian_phone && <span>Telefone: <strong>{formatPhoneBr(c.guardian_phone)}</strong></span>}
                    </div>
                  </div>

                  <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "right" }}>
                    <span>Data: {birthDt.getUTCDate().toString().padStart(2, "0")}/{(birthDt.getUTCMonth() + 1).toString().padStart(2, "0")}/{birthDt.getFullYear()}</span>
                  </div>
                </div>
              </Card>
            );
          })}

          {children.length === 0 && (
            <Card style={{ padding: "36px", textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎈</div>
              <h4 style={{ margin: 0, fontSize: "16px", color: "var(--text-main)" }}>
                {mode === "today"
                  ? `Nenhum aniversariante hoje (${formattedTodayDate})`
                  : `Nenhum aniversariante encontrado em ${MONTHS[selectedMonth - 1]}`}
              </h4>
              <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
                {mode === "today"
                  ? "Não há crianças cadastradas fazendo aniversário no dia de hoje."
                  : "Não há registros de aniversário para o mês selecionado."}
              </p>
            </Card>
          )}
        </ul>
      )}
    </div>
  );
}

function TurnosTab({ unitId }: { unitId: string }) {
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);

  useEffect(() => {
    Api.reportShifts(unitId).then(setShifts);
  }, [unitId]);

  return (
    <Card style={{ padding: "8px", marginTop: "16px", overflowX: "auto" }}>
      <table className="report-table">
        <thead>
          <tr>
            <th>Abertura</th>
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
              <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                Nenhum turno registrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
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
  const { unit } = useAppState();
  const [rows, setRows] = useState<FolhaPontoRow[]>([]);

  useEffect(() => {
    const fParts = from.split("-").map((v) => Number(v) || 0);
    const tParts = to.split("-").map((v) => Number(v) || 0);
    const fY = fParts[0] || 2026;
    const fM = fParts[1] || 1;
    const fD = fParts[2] || 1;
    const tY = tParts[0] || 2026;
    const tM = tParts[1] || 1;
    const tD = tParts[2] || 1;
    const fromMs = new Date(fY, fM - 1, fD, 0, 0, 0, 0).getTime();
    const toMs = new Date(tY, tM - 1, tD, 23, 59, 59, 999).getTime();
    Api.reportPonto(fromMs, toMs, unit?.id).then(setRows).catch(() => setRows([]));
  }, [from, to, unit?.id]);

  const dailySummaries = summarizeDailyHours(rows);

  return (
    <div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "16px", marginTop: "24px" }}>Resumo de horas por colaborador/dia</h3>
      <Card style={{ padding: "8px", marginBottom: "24px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Colaborador</th>
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
                      fontWeight: "var(--weight-bold)" as unknown as number,
                      color: diffMs === null ? undefined : diffMs < -15 * 60_000 ? "var(--color-error-text)" : diffMs > 15 * 60_000 ? "var(--color-amber-text)" : "var(--color-teal-text)",
                    }}
                  >
                    {diffMs === null ? "—" : `${diffMs >= 0 ? "+" : "-"}${formatDurationMs(Math.abs(diffMs))}`}
                  </td>
                </tr>
              );
            })}
            {dailySummaries.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhuma marcação no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "16px" }}>Marcações (registro de auditoria)</h3>
        <Button variant="secondary" size="sm" disabled={rows.length === 0} onClick={() => exportFrequenciaCsv(rows)}>
          ⬇️ Exportar CSV
        </Button>
      </div>
      <Card style={{ padding: "8px", marginTop: "16px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Colaborador</th>
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
      </Card>
    </div>
  );
}

export function FrotaHeatmapTab({ unitId, from, to }: { unitId: string; from: string; to: string }) {
  const [usage, setUsage] = useState<AssetUsage[]>([]);

  useEffect(() => {
    Api.reportAssetUsage(unitId, from, to).then(setUsage);
  }, [unitId, from, to]);

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

/**
 * Check-ins por hora do dia — quando unitId é null (visão Gerencial "Todas
 * as unidades"), compara as unidades lado a lado na mesma hora em vez de
 * somar tudo, porque o valor do relatório aqui é ver o pico de movimento
 * de cada unidade, não um total agregado sem detalhe.
 */
export function CheckinsPorHoraTab({ unitId, from, to }: { unitId: string | null; from: string; to: string }) {
  const [rows, setRows] = useState<CheckinsByHour[]>([]);

  useEffect(() => {
    Api.reportCheckinsByHour(unitId, from, to).then(setRows);
  }, [unitId, from, to]);

  const unitNames = [...new Set(rows.map((r) => r.unit_name))].sort();
  const byHour = new Map<number, Record<string, number | string>>();
  for (let h = 0; h < 24; h++) byHour.set(h, { hourLabel: `${String(h).padStart(2, "0")}h` });
  for (const r of rows) {
    const entry = byHour.get(r.hour);
    if (entry) entry[r.unit_name] = r.count;
  }
  const chartData = [...byHour.values()];
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const peak = rows.reduce<CheckinsByHour | null>((best, r) => (r.count > (best?.count ?? 0) ? r : best), null);

  return (
    <div>
      <Card style={{ padding: "16px", margin: "16px 0" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px" }}>Total de check-ins no período: {total}</h2>
        {peak && (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
            Horário de pico: {String(peak.hour).padStart(2, "0")}h ({peak.count} check-in{peak.count === 1 ? "" : "s"}
            {unitId === null ? ` — ${peak.unit_name}` : ""})
          </p>
        )}
      </Card>
      <div style={{ marginBottom: "16px" }}>
        <CheckinsByHourChart data={chartData} unitNames={unitNames} />
      </div>
      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Hora</th>
              {unitId === null && <th>Unidade</th>}
              <th>Check-ins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.unit_id}-${r.hour}`}>
                <td>{String(r.hour).padStart(2, "0")}h</td>
                {unitId === null && <td>{r.unit_name}</td>}
                <td style={{ textAlign: "center" }}>{r.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={unitId === null ? 3 : 2} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhum check-in encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
