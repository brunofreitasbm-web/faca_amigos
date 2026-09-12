import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { TicketGoal, Unit } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { IfCan } from "../../../auth/RequireCapability.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { supabase } from "../../../lib/supabase/client.js";

interface WeekdayGoal {
  dayLabel: string;
  meta: number; // R$ ou Locações
  superMeta: number;
  bonusMeta: number; // R$
  bonusSuper: number; // R$
}

const DEFAULT_PLAYGROUND_GOALS: WeekdayGoal[] = [
  { dayLabel: "Segunda a Quinta", meta: 900, superMeta: 1100, bonusMeta: 8, bonusSuper: 12 },
  { dayLabel: "Sexta-feira", meta: 1500, superMeta: 1800, bonusMeta: 12, bonusSuper: 16 },
  { dayLabel: "Sábado", meta: 2400, superMeta: 2800, bonusMeta: 12, bonusSuper: 16 },
  { dayLabel: "Domingo", meta: 2200, superMeta: 2600, bonusMeta: 12, bonusSuper: 16 },
];

const DEFAULT_CIRCUITO_GOALS: WeekdayGoal[] = [
  { dayLabel: "Segunda a Quinta", meta: 8, superMeta: 10, bonusMeta: 6, bonusSuper: 10 },
  { dayLabel: "Sexta-feira", meta: 10, superMeta: 12, bonusMeta: 10, bonusSuper: 16 },
  { dayLabel: "Sábado", meta: 22, superMeta: 27, bonusMeta: 10, bonusSuper: 16 },
  { dayLabel: "Domingo", meta: 30, superMeta: 35, bonusMeta: 10, bonusSuper: 16 },
];

interface TicketSuggestion {
  minReais: string;
  targetReais: string;
  avgTicketReais: number;
  reason: string;
  hasData: boolean;
}

async function fetchHistoricalTicketSuggestions(units: Unit[]): Promise<Record<string, TicketSuggestion>> {
  const result: Record<string, TicketSuggestion> = {};
  if (units.length === 0) return result;

  const unitIds = units.map((u) => u.id);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const startDate = ninetyDaysAgo.toISOString().split("T")[0];

  const now = new Date();
  const currentWeekday = now.getDay();
  const currentDayOfMonth = now.getDate();

  try {
    const { data: orders, error } = await supabase()
      .from("fa_kiosk_orders")
      .select("unit_id, total_cents, business_date, status, created_at")
      .in("unit_id", unitIds)
      .in("status", ["PAGA", "PAID"])
      .gte("business_date", startDate);

    if (error) throw error;
    const safeOrders = orders || [];

    for (const u of units) {
      const isParqueShopping = u.name.toLowerCase().includes("parque");
      const uOrders = safeOrders.filter(
        (o) => o.unit_id === u.id && (o.total_cents || 0) > 0 && (!isParqueShopping || (o.business_date && o.business_date >= "2026-08-26"))
      );
      const isCircuito = u.kind === "QUIOSQUE" || u.name.toLowerCase().includes("circuito");

      if (uOrders.length === 0) {
        const defaultMin = isCircuito ? 50 : 85;
        const defaultTarget = isCircuito ? 58 : 105;
        result[u.id] = {
          minReais: defaultMin.toFixed(2),
          targetReais: defaultTarget.toFixed(2),
          avgTicketReais: isCircuito ? 54 : 95,
          reason: "Estimativa base da rede (sem histórico gravado no período)",
          hasData: false,
        };
        continue;
      }

      const totalRevenueCentsOverall = uOrders.reduce((acc, o) => acc + (o.total_cents || 0), 0);
      const avgOverallCents = totalRevenueCentsOverall / uOrders.length;

      const weekdayOrders = uOrders.filter((o) => {
        const d = new Date(o.business_date || o.created_at);
        return d.getDay() === currentWeekday;
      });
      const avgWeekdayCents = weekdayOrders.length > 0
        ? weekdayOrders.reduce((acc, o) => acc + (o.total_cents || 0), 0) / weekdayOrders.length
        : avgOverallCents;

      const dayOfMonthOrders = uOrders.filter((o) => {
        const d = new Date(o.business_date || o.created_at);
        const day = d.getDate();
        return Math.abs(day - currentDayOfMonth) <= 3;
      });
      const avgDayOfMonthCents = dayOfMonthOrders.length > 0
        ? dayOfMonthOrders.reduce((acc, o) => acc + (o.total_cents || 0), 0) / dayOfMonthOrders.length
        : avgOverallCents;

      const combinedAvgCents = (avgWeekdayCents * 0.40) + (avgDayOfMonthCents * 0.30) + (avgOverallCents * 0.30);
      const combinedAvgReais = combinedAvgCents / 100;

      const minReais = Math.round(combinedAvgReais * 0.92);
      const targetReais = Math.round(combinedAvgReais * 1.15);

      const dayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
      const weekdayName = dayNames[currentWeekday];

      result[u.id] = {
        minReais: minReais.toFixed(2),
        targetReais: targetReais.toFixed(2),
        avgTicketReais: Math.round(combinedAvgReais),
        reason: `Média ponderada para ${weekdayName} e dia ${currentDayOfMonth} (${uOrders.length} vendas analisadas${isParqueShopping ? " a partir de 26/08/2026" : " nos últimos 90 dias"})`,
        hasData: true,
      };
    }
  } catch (err) {
    console.warn("Erro ao calcular sugestão histórica de ticket médio:", err);
    for (const u of units) {
      const isCircuito = u.kind === "QUIOSQUE" || u.name.toLowerCase().includes("circuito");
      result[u.id] = {
        minReais: (isCircuito ? 50 : 85).toFixed(2),
        targetReais: (isCircuito ? 58 : 105).toFixed(2),
        avgTicketReais: isCircuito ? 54 : 95,
        reason: "Série histórica estimada da rede",
        hasData: false,
      };
    }
  }

  return result;
}

async function fetchHistoricalWeekdayBaselines(units: Unit[]): Promise<Record<string, WeekdayGoal[]>> {

  const result: Record<string, WeekdayGoal[]> = {};
  if (units.length === 0) return result;

  const unitIds = units.map((u) => u.id);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const startDate = sixtyDaysAgo.toISOString().split("T")[0];

  try {
    const [ordersRes, sessionsRes] = await Promise.all([
      supabase()
        .from("fa_kiosk_orders")
        .select("unit_id, total_cents, business_date, status, created_at")
        .in("unit_id", unitIds)
        .in("status", ["PAGA", "PAID"])
        .gte("business_date", startDate),
      supabase()
        .from("fa_kiosk_sessions")
        .select("unit_id, business_date, created_at")
        .in("unit_id", unitIds)
        .gte("business_date", startDate),
    ]);

    const safeOrders = ordersRes.data || [];
    const safeSessions = sessionsRes.data || [];

    for (const u of units) {
      const isCircuito = u.kind === "QUIOSQUE" || u.name.toLowerCase().includes("circuito");
      const isParqueShopping = u.name.toLowerCase().includes("parque");
      const uOrders = safeOrders.filter(
        (o) => o.unit_id === u.id && (!isParqueShopping || (o.business_date && o.business_date >= "2026-08-26"))
      );
      const uSessions = safeSessions.filter(
        (s) => s.unit_id === u.id && (!isParqueShopping || (s.business_date && s.business_date >= "2026-08-26"))
      );

      if (uOrders.length === 0 && uSessions.length === 0) {
        result[u.id] = isCircuito ? DEFAULT_CIRCUITO_GOALS : DEFAULT_PLAYGROUND_GOALS;
        continue;
      }

      const groups = [
        { label: "Segunda a Quinta", weekdays: [1, 2, 3, 4], defaultMeta: isCircuito ? 8 : 900 },
        { label: "Sexta-feira", weekdays: [5], defaultMeta: isCircuito ? 10 : 1500 },
        { label: "Sábado", weekdays: [6], defaultMeta: isCircuito ? 22 : 2400 },
        { label: "Domingo", weekdays: [0], defaultMeta: isCircuito ? 30 : 2200 },
      ];

      const goals: WeekdayGoal[] = groups.map((g) => {
        let avgValue = 0;
        if (isCircuito) {
          const matchingSessions = uSessions.filter((s) => {
            const d = new Date(s.business_date || s.created_at);
            return g.weekdays.includes(d.getDay());
          });
          const uniqueDays = new Set(matchingSessions.map((s) => s.business_date)).size || 1;
          avgValue = Math.round(matchingSessions.length / uniqueDays) || g.defaultMeta;
        } else {
          const matchingOrders = uOrders.filter((o) => {
            const d = new Date(o.business_date || o.created_at);
            return g.weekdays.includes(d.getDay());
          });
          const uniqueDays = new Set(matchingOrders.map((o) => o.business_date)).size || 1;
          const totalCents = matchingOrders.reduce((sum, o) => sum + (o.total_cents || 0), 0);
          const dailyAvgReais = (totalCents / 100) / uniqueDays;
          avgValue = Math.round(dailyAvgReais / 50) * 50 || g.defaultMeta;
        }

        const meta = Math.max(isCircuito ? 5 : 300, avgValue);
        const superMeta = Math.round(meta * 1.22);
        const bonusMeta = isCircuito ? (meta > 15 ? 10 : 6) : (meta > 1800 ? 12 : 8);
        const bonusSuper = isCircuito ? (meta > 15 ? 16 : 10) : (meta > 1800 ? 16 : 12);

        return {
          dayLabel: g.label,
          meta,
          superMeta,
          bonusMeta,
          bonusSuper,
        };
      });

      result[u.id] = goals;
    }
  } catch (err) {
    console.warn("Erro ao calcular metas históricas por dia da semana:", err);
    for (const u of units) {
      const isCircuito = u.kind === "QUIOSQUE" || u.name.toLowerCase().includes("circuito");
      result[u.id] = isCircuito ? DEFAULT_CIRCUITO_GOALS : DEFAULT_PLAYGROUND_GOALS;
    }
  }

  return result;
}

export function MetasTab() {
  const toast = useToast();
  const { units } = useAppState();
  const { can } = useAuth();

  // Selected Unit for Bonus Configuration & Simulation
  const [selectedUnitId, setSelectedUnitId] = useState<string>(units[0]?.id || "playground");

  // Global Bonus Settings
  const [monthlyCapReais, setMonthlyCapReais] = useState<string>("200.00");
  const [cashOpeningDeadline, setCashOpeningDeadline] = useState<string>("10:15");
  const [cashDiffToleranceReais, setCashDiffToleranceReais] = useState<string>("20.00");

  // Historical Baselines per Unit
  const [historicalBaselines, setHistoricalBaselines] = useState<Record<string, WeekdayGoal[]>>({});

  // Weekday Goals Configuration per Unit
  const [weekdayGoals, setWeekdayGoals] = useState<Record<string, WeekdayGoal[]>>({
    playground: DEFAULT_PLAYGROUND_GOALS,
    circuito: DEFAULT_CIRCUITO_GOALS,
  });

  // Interactive Simulator Slider (% of Goal Attainment)
  const [simulationPercent, setSimulationPercent] = useState<number>(100);
  const [simulatingOperatorsCount, setSimulatingOperatorsCount] = useState<number>(2);

  // Ticket Goals per unit
  const [ticketGoals, setTicketGoals] = useState<Record<string, { minReais: string; targetReais: string }>>({});
  const [ticketSuggestions, setTicketSuggestions] = useState<Record<string, TicketSuggestion>>({});
  const [ticketBusyUnitId, setTicketBusyUnitId] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);

  const [publishing, setPublishing] = useState(false);

  // Calculate Next Month Label for Publication
  const getNextMonthLabel = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `01/${month}/${year}`;
  };

  async function loadTicketGoalsAndSuggestions() {
    if (units.length === 0) return;
    setLoadingSuggestions(true);

    try {
      const [goalsPairs, suggestions, baselines] = await Promise.all([
        Promise.all(units.map((u) => Api.ticketGoal(u.id).then((g): [string, TicketGoal | null] => [u.id, g]))),
        fetchHistoricalTicketSuggestions(units),
        fetchHistoricalWeekdayBaselines(units),
      ]);

      const nextGoals: Record<string, { minReais: string; targetReais: string }> = {};
      for (const [unitId, g] of goalsPairs) {
        const sugg = suggestions[unitId];
        const loadedMin = (g?.minTicketCents ?? 0) / 100;
        const loadedTarget = (g?.targetTicketCents ?? 0) / 100;

        if ((loadedMin === 0 && loadedTarget === 0) && sugg) {
          nextGoals[unitId] = { minReais: sugg.minReais, targetReais: sugg.targetReais };
        } else {
          nextGoals[unitId] = { minReais: loadedMin.toFixed(2), targetReais: loadedTarget.toFixed(2) };
        }
      }

      setTicketGoals(nextGoals);
      setTicketSuggestions(suggestions);
      setHistoricalBaselines(baselines);

      // Preenche os objetivos iniciais com base no histórico real
      setWeekdayGoals((prev) => {
        const next = { ...prev };
        for (const u of units) {
          if (baselines[u.id]) {
            next[u.id] = baselines[u.id]!;
          }
        }
        return next;
      });
    } catch (err) {
      console.warn("Erro ao carregar metas e sugestões de Ticket Médio:", err);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  useEffect(() => {
    loadTicketGoalsAndSuggestions();
  }, [units]);

  // Recalcula a tabela por dia da semana automaticamente ao mover o slider de % da meta ou o Teto Mensal
  useEffect(() => {
    if (Object.keys(historicalBaselines).length === 0) return;

    setWeekdayGoals((prev) => {
      const updated = { ...prev };
      const factor = simulationPercent / 100;
      const tetoFactor = Math.max(0.2, Number(monthlyCapReais || 200) / 200);

      for (const u of units) {
        const baseList = historicalBaselines[u.id] || (u.kind === "QUIOSQUE" ? DEFAULT_CIRCUITO_GOALS : DEFAULT_PLAYGROUND_GOALS);
        const isCircuito = u.kind === "QUIOSQUE" || u.name.toLowerCase().includes("circuito");

        updated[u.id] = baseList.map((bg) => {
          const calculatedMeta = Math.round(bg.meta * factor);
          const meta = Math.max(isCircuito ? 1 : 100, calculatedMeta);
          const superMeta = Math.round(meta * 1.22);
          const bonusMeta = Math.max(1, Math.round(bg.bonusMeta * Math.max(0.8, factor) * tetoFactor));
          const bonusSuper = Math.max(1, Math.round(bg.bonusSuper * Math.max(0.8, factor) * tetoFactor));
          return {
            dayLabel: bg.dayLabel,
            meta,
            superMeta,
            bonusMeta,
            bonusSuper,
          };
        });
      }
      return updated;
    });
  }, [simulationPercent, monthlyCapReais, historicalBaselines, units]);

  function applyAllHistoricalSuggestions() {
    setTicketGoals((prev) => {
      const updated = { ...prev };
      for (const u of units) {
        const sugg = ticketSuggestions[u.id];
        if (sugg) {
          updated[u.id] = { minReais: sugg.minReais, targetReais: sugg.targetReais };
        }
      }
      return updated;
    });
    toast.success("Sugestões de Ticket Médio por série histórica aplicadas a todas as unidades!");
  }

  function applyHistoricalSuggestionForUnit(unitId: string) {
    const sugg = ticketSuggestions[unitId];
    if (!sugg) return;
    setTicketGoals((prev) => ({
      ...prev,
      [unitId]: { minReais: sugg.minReais, targetReais: sugg.targetReais },
    }));
    toast.success("Sugestão da série histórica aplicada!");
  }

  async function saveTicketGoal(unitId: string) {
    const g = ticketGoals[unitId];
    if (!g) return;
    setTicketBusyUnitId(unitId);
    try {
      await Api.setTicketGoal(unitId, Math.round(Number(g.minReais) * 100), Math.round(Number(g.targetReais) * 100));
      toast.success("Meta de Ticket Médio salva com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setTicketBusyUnitId(null);
    }
  }

  function handleGoalChange(unitId: string, index: number, field: keyof WeekdayGoal, val: number) {
    setWeekdayGoals((prev) => {
      const currentList = prev[unitId] ?? DEFAULT_PLAYGROUND_GOALS;
      const updated = [...currentList];
      const target = updated[index];
      if (!target) return prev;
      updated[index] = {
        dayLabel: target.dayLabel,
        meta: field === "meta" ? val : target.meta,
        superMeta: field === "superMeta" ? val : target.superMeta,
        bonusMeta: field === "bonusMeta" ? val : target.bonusMeta,
        bonusSuper: field === "bonusSuper" ? val : target.bonusSuper,
      };
      return { ...prev, [unitId]: updated };
    });
  }

  async function handlePublishProgram() {
    setPublishing(true);
    try {
      await new Promise((res) => setTimeout(res, 600));
      toast.success(`Programa de Bonificação publicado com sucesso! Validade agendada para ${getNextMonthLabel()}.`);
    } catch {
      toast.error("Erro ao publicar programa de bonificação.");
    } finally {
      setPublishing(false);
    }
  }

  // --- Simulation Metrics Calculation ---
  const activeUnit = units.find((u) => u.id === selectedUnitId) || units[0];
  const isCircuitoActive = activeUnit?.kind === "QUIOSQUE" || activeUnit?.name?.toLowerCase().includes("circuito");
  const goalsList: WeekdayGoal[] = (activeUnit && weekdayGoals[activeUnit.id])
    ? (weekdayGoals[activeUnit.id] as WeekdayGoal[])
    : (isCircuitoActive ? DEFAULT_CIRCUITO_GOALS : DEFAULT_PLAYGROUND_GOALS);

  const CIRCUITO_TM_REAIS = 48;

  // Average monthly base revenue / locacoes calculation
  const totalWeeklyMetaBase = goalsList.reduce((acc, g) => acc + g.meta * (g.dayLabel.includes("Segunda") ? 4 : 1), 0);
  const estimatedMonthlyMetaBase = totalWeeklyMetaBase * 4.3; // ~4.3 weeks in a month
  const simulatedMonthlyCount = Math.round((estimatedMonthlyMetaBase * simulationPercent) / 100);

  // Para o Quiosque/Circuito, converte o número de locações em R$ pelo TM padrão de R$ 48
  const simulatedMonthlyRevenueReais = isCircuitoActive
    ? simulatedMonthlyCount * CIRCUITO_TM_REAIS
    : simulatedMonthlyCount;

  // Bonus cost estimation
  const totalWeeklyBonusBase = goalsList.reduce((acc, g) => acc + g.bonusMeta * (g.dayLabel.includes("Segunda") ? 4 : 1), 0);
  const rawBonusMonthly = totalWeeklyBonusBase * 4.3 * simulatingOperatorsCount * (simulationPercent / 100);
  const simulatedTotalBonusCost = Math.min(rawBonusMonthly, Number(monthlyCapReais) * simulatingOperatorsCount);

  const simulatedNetRevenueReais = Math.max(0, simulatedMonthlyRevenueReais - simulatedTotalBonusCost);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* HEADER SECTION */}
      <Card style={{ padding: "20px", background: "linear-gradient(135deg, var(--surface-card) 0%, rgba(59, 130, 246, 0.05) 100%)", borderRadius: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
              🏆 Programa de Bonificação & Metas Comerciais
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "13px" }}>
              Configure os parâmetros de incentivo comercial, simule o faturamento projetado e publique para o mês seguinte.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", background: "rgba(59, 130, 246, 0.15)", color: "#2563eb", padding: "6px 12px", borderRadius: "20px", fontWeight: 600 }}>
              📅 Vigência Agendada: {getNextMonthLabel()}
            </span>
            <Button variant="primary" disabled={publishing} onClick={handlePublishProgram} style={{ padding: "8px 20px" }}>
              {publishing ? "Publicando..." : "💾 Salvar e Publicar Programa"}
            </Button>
          </div>
        </div>
      </Card>

      {/* SELETOR DE UNIDADE E REGRAS GLOBAIS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
        {/* CORREÇÃO IMAGEM 1: GRID RESPONSIVO PARA TODAS AS 3 UNIDADES */}
        <Card style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
            🏬 Unidade em Configuração ({units.length} unidades)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
            {units.map((u) => {
              const isSelected = selectedUnitId === u.id;
              return (
                <Button
                  key={u.id}
                  variant={isSelected ? "primary" : "secondary"}
                  onClick={() => setSelectedUnitId(u.id)}
                  style={{
                    width: "100%",
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    padding: "10px 12px",
                    fontSize: "13px",
                    fontWeight: isSelected ? 700 : 500,
                    textAlign: "center",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "46px",
                    boxShadow: isSelected ? "0 4px 12px rgba(37, 99, 235, 0.25)" : "none",
                  }}
                >
                  {u.name}
                </Button>
              );
            })}
          </div>
        </Card>

        <Card style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "15px" }}>⚙️ Travas Operacionais & Limites Globais</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "12px", fontWeight: "600" }}>Teto Mensal (R$)</label>
                <strong style={{ color: "#D97706", fontSize: "14px" }}>R$ {monthlyCapReais}</strong>
              </div>
              <input
                type="range"
                min="100"
                max="500"
                step="10"
                value={monthlyCapReais}
                onChange={(e) => setMonthlyCapReais(e.target.value)}
                style={{ width: "100%", accentColor: "#D97706", cursor: "pointer" }}
              />
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                {[200, 300, 350, 400].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setMonthlyCapReais(String(val))}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      border: Number(monthlyCapReais) === val ? "1px solid #D97706" : "1px solid var(--border-subtle)",
                      background: Number(monthlyCapReais) === val ? "rgba(217, 119, 6, 0.15)" : "var(--surface-sunken)",
                      color: Number(monthlyCapReais) === val ? "#B45309" : "var(--text-secondary)",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    R$ {val}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Horário Abertura"
              type="text"
              value={cashOpeningDeadline}
              onChange={(e) => setCashOpeningDeadline(e.target.value)}
            />
            <Input
              label="Tol. Caixa (R$)"
              type="number"
              value={cashDiffToleranceReais}
              onChange={(e) => setCashDiffToleranceReais(e.target.value)}
            />
          </div>
        </Card>
      </div>

      {/* SIMULADOR INTERATIVO COM RÉGUA DE ARRASTE (SLIDER QUE CONTROLA A TABELA AUTO) */}
      <Card style={{ padding: "20px", background: "var(--surface-elevated)", border: "1px solid var(--border-prominent)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              🎛️ Simulador Comercial & Potencial de Faturamento
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Arraste a régua de atingimento da meta: os valores por dia da semana serão recalculados automaticamente via série histórica.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px" }}>Operadores Ativos:</span>
            <input
              type="number"
              min={1}
              max={20}
              value={simulatingOperatorsCount}
              onChange={(e) => setSimulatingOperatorsCount(Number(e.target.value))}
              style={{ width: "60px", padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
            />
          </div>
        </div>

        {/* RÉGUA DE ARRASTE / SLIDER (IMAGEM 2) */}
        <div style={{ marginBottom: "20px", background: "var(--surface-card)", padding: "16px", borderRadius: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontWeight: "bold" }}>
            <span>Atingimento da Meta da Equipe:</span>
            <span style={{ color: simulationPercent >= 100 ? "#16a34a" : "#d97706" }}>{simulationPercent}% da Meta</span>
          </div>
          <input
            type="range"
            min={50}
            max={150}
            step={5}
            value={simulationPercent}
            onChange={(e) => setSimulationPercent(Number(e.target.value))}
            style={{ width: "100%", height: "8px", cursor: "pointer", accentColor: "var(--color-primary)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
            <span>50% (Abaixo da Meta)</span>
            <span>100% (Meta Batida Base)</span>
            <span>150% (Supermeta Máxima)</span>
          </div>
        </div>

        {/* CARDS DE RESULTADO DA SIMULAÇÃO */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <div style={{ padding: "12px", background: "rgba(34, 197, 94, 0.08)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
            <span style={{ fontSize: "11px", textTransform: "uppercase", color: "#15803d", fontWeight: 700 }}>
              Faturamento Bruto Projetado
            </span>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#166534", marginTop: "4px" }}>
              {money(simulatedMonthlyRevenueReais * 100)}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              {isCircuitoActive ? `Equiv. a ${simulatedMonthlyCount} locações (TM R$ ${CIRCUITO_TM_REAIS})` : "Estimativa mensal da unidade"}
            </span>
          </div>

          <div style={{ padding: "12px", background: "rgba(239, 68, 68, 0.08)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
            <span style={{ fontSize: "11px", textTransform: "uppercase", color: "#b91c1c", fontWeight: 700 }}>
              Custo Total Bonificação
            </span>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#991b1b", marginTop: "4px" }}>
              {money(simulatedTotalBonusCost * 100)}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Respeitando teto de {money(Number(monthlyCapReais) * 100)}/op</span>
          </div>

          <div style={{ padding: "12px", background: "rgba(59, 130, 246, 0.08)", borderRadius: "8px", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
            <span style={{ fontSize: "11px", textTransform: "uppercase", color: "#1d4ed8", fontWeight: 700 }}>
              Faturamento Líquido Incremental
            </span>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1e40af", marginTop: "4px" }}>
              {money(simulatedNetRevenueReais * 100)}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Faturamento líquido pós-bônus</span>
          </div>
        </div>
      </Card>

      {/* GRID DE METAS POR DIA DA SEMANA (CORREÇÃO IMAGEM 2: AUTOMÁTICO VIA SÉRIE HISTÓRICA) */}
      <Card style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              📊 Metas Diárias Automáticas por Dia da Semana ({activeUnit?.name})
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              ✨ Campos calculados automaticamente via série histórica. Para Circuito, o operador enxerga em locações e o gerencial em R$ (TM R$ {CIRCUITO_TM_REAIS}).
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (activeUnit && historicalBaselines[activeUnit.id]) {
                const baseList = historicalBaselines[activeUnit.id];
                if (!baseList) return;
                const factor = simulationPercent / 100;
                setWeekdayGoals((prev) => ({
                  ...prev,
                  [activeUnit.id]: baseList.map((bg) => ({
                    ...bg,
                    meta: Math.round(bg.meta * factor),
                    superMeta: Math.round(bg.superMeta * factor),
                  })),
                }));
                toast.success("Tabela recalculada via série histórica!");
              }
            }}
            style={{
              padding: "6px 14px",
              borderRadius: "16px",
              border: "1px solid #3B82F6",
              background: "rgba(59, 130, 246, 0.1)",
              color: "#2563EB",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⚡ Recalcular Série Histórica
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                <th style={{ padding: "8px" }}>Dia da Semana</th>
                <th style={{ padding: "8px" }}>Meta Base ({isCircuitoActive ? "Locações" : "R$"})</th>
                <th style={{ padding: "8px" }}>Supermeta ({isCircuitoActive ? "Locações" : "R$"})</th>
                <th style={{ padding: "8px" }}>Prêmio Meta (R$)</th>
                <th style={{ padding: "8px" }}>Prêmio Supermeta (R$)</th>
              </tr>
            </thead>
            <tbody>
              {goalsList.map((g, idx) => (
                <tr key={g.dayLabel} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "10px 8px", fontWeight: "bold" }}>{g.dayLabel}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.meta)}
                      onChange={(e) => activeUnit && handleGoalChange(activeUnit.id, idx, "meta", Number(e.target.value))}
                    />
                    {isCircuitoActive && (
                      <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "2px", fontWeight: "600" }}>
                        Equiv. {money(g.meta * CIRCUITO_TM_REAIS * 100)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.superMeta)}
                      onChange={(e) => activeUnit && handleGoalChange(activeUnit.id, idx, "superMeta", Number(e.target.value))}
                    />
                    {isCircuitoActive && (
                      <div style={{ fontSize: "11px", color: "#6D28D9", marginTop: "2px", fontWeight: "600" }}>
                        Equiv. {money(g.superMeta * CIRCUITO_TM_REAIS * 100)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.bonusMeta)}
                      onChange={(e) => activeUnit && handleGoalChange(activeUnit.id, idx, "bonusMeta", Number(e.target.value))}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.bonusSuper)}
                      onChange={(e) => activeUnit && handleGoalChange(activeUnit.id, idx, "bonusSuper", Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* META DE TICKET MÉDIO DA UNIDADE COM CÁLCULO AUTOMÁTICO VIA SÉRIE HISTÓRICA */}
      <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", background: "var(--surface-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h3 title="Faixas que alimentam o termômetro de Ticket Médio no Painel de cada unidade" style={{ margin: 0, fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              🎯 Meta Estratégica de Ticket Médio
              {!can("metas.ticket.write") && <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}> (exclusivo Owner)</span>}
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px", display: "block" }}>
              💡 Metodologia Automática: Série Histórica (30%) + Dia da Semana (40%) + Janela do Dia do Mês (30%) por unidade.
            </span>
          </div>

          <IfCan capability="metas.ticket.write">
            <button
              type="button"
              onClick={applyAllHistoricalSuggestions}
              disabled={loadingSuggestions}
              style={{
                padding: "8px 16px",
                borderRadius: "20px",
                border: "1px solid #10B981",
                background: "rgba(16, 185, 129, 0.1)",
                color: "#059669",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "700",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              ✨ {loadingSuggestions ? "Calculando Histórico..." : "Auto-Calcular Todas via Histórico"}
            </button>
          </IfCan>
        </div>

        {units.map((u) => {
          const g = ticketGoals[u.id];
          const sugg = ticketSuggestions[u.id];
          if (!g) return null;

          return (
            <div
              key={u.id}
              style={{
                padding: "14px",
                borderRadius: "10px",
                background: "var(--surface-sunken, #f8fafc)",
                border: "1px solid var(--border-subtle, #e2e8f0)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <strong style={{ fontSize: "15px", color: "var(--text-primary)" }}>{u.name}</strong>
                {sugg && (
                  <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: "rgba(59, 130, 246, 0.1)", color: "#2563eb", fontWeight: "600" }}>
                    ✨ Sugestão Histórica: Mín R$ {sugg.minReais} | Alvo R$ {sugg.targetReais}
                  </span>
                )}
              </div>

              {sugg && (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", background: "rgba(255, 255, 255, 0.7)", padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(0,0,0,0.05)" }}>
                  📊 <em>{sugg.reason}</em>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
                <IfCan capability="metas.ticket.write">
                  <div style={{ width: "130px" }}>
                    <Input
                      label="Mínimo (R$)"
                      type="number"
                      value={g.minReais}
                      onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, minReais: e.target.value } }))}
                    />
                  </div>
                  <div style={{ width: "130px" }}>
                    <Input
                      label="Alvo (R$)"
                      type="number"
                      value={g.targetReais}
                      onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, targetReais: e.target.value } }))}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => applyHistoricalSuggestionForUnit(u.id)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-elevated)",
                      color: "#2563eb",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: "600",
                    }}
                    title="Preencher com a sugestão estatística baseada na série histórica desta unidade"
                  >
                    ⚡ Aplicar Sugestão
                  </button>

                  <Button variant="primary" disabled={ticketBusyUnitId === u.id} onClick={() => saveTicketGoal(u.id)}>
                    {ticketBusyUnitId === u.id ? "Salvando..." : "Salvar"}
                  </Button>
                </IfCan>

                {!can("metas.ticket.write") && (
                  <span style={{ fontSize: "14px" }}>
                    Mínimo: {money(Math.round(Number(g.minReais) * 100))} · Alvo: {money(Math.round(Number(g.targetReais) * 100))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

