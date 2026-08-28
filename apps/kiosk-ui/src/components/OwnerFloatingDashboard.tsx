import { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Button, Card, Modal, WalletIcon, GridIcon, ChartBarIcon, ArrowClockwiseIcon } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { useAuth } from "../auth/AuthContext.js";
import { Api, businessDateFor } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { money } from "../format.js";

interface UnitSummary {
  unitId: string;
  unitName: string;
  revenueCents: number;
  sessionsCount: number;
  ticketMedioCents: number;
  minTicketCents: number;
  targetTicketCents: number;
}

interface HourlyProgressData {
  hourLabel: string;
  total: number;
  [unitName: string]: number | string;
}

// Cores do gráfico: os 4 primeiros nomes vêm de --chart-1..4 (mesma
// paleta de BI usada no Relatório); os 2 extras cobrem uma 5ª/6ª unidade
// sem repetir cor, usando marca (pink/amber) em vez de inventar tons novos.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--color-pink)",
  "var(--color-amber)",
];

const tooltipStyle = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  boxShadow: "var(--shadow-md)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  padding: "8px 12px",
};

export function OwnerFloatingDashboard() {
  const { employee, units } = useAppState();
  const { can } = useAuth();

  // Verifica se o usuário é OWNER (ADMIN ou possui capacidade de gestão)
  const isOwner = employee?.role === "ADMIN" || can("notificacoes.owner_push") || can("config.rbac.write");

  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("ALL"); // 'ALL' = Consolidado

  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const [unitSummaries, setUnitSummaries] = useState<UnitSummary[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyProgressData[]>([]);

  // Totais consolidados
  const totalRevenueCents = unitSummaries.reduce((acc, u) => acc + u.revenueCents, 0);
  const totalSessionsCount = unitSummaries.reduce((acc, u) => acc + u.sessionsCount, 0);
  const overallTicketMedioCents =
    totalSessionsCount > 0 ? Math.round(totalRevenueCents / totalSessionsCount) : 0;

  // Recarregar dados
  const loadDashboardData = useCallback(async () => {
    if (!isOwner || units.length === 0) return;
    setLoading(true);

    try {
      const todayStr = businessDateFor(Date.now(), 3); // cutoff 3h

      const summaries: UnitSummary[] = await Promise.all(
        units.map(async (u: Unit) => {
          const cutoff = u.business_day_cutoff_hour ?? 3;
          const [rev, tm, goal] = await Promise.all([
            Api.todayRevenue(u.id, cutoff).catch(() => ({ totalCents: 0 })),
            Api.todayTicketMedio(u.id, cutoff).catch(() => ({
              totalCents: 0,
              ordersCount: 0,
              avgCents: 0,
            })),
            Api.ticketGoal(u.id).catch(() => null),
          ]);

          return {
            unitId: u.id,
            unitName: u.name,
            revenueCents: rev.totalCents,
            sessionsCount: tm.ordersCount,
            ticketMedioCents: tm.avgCents,
            minTicketCents: goal?.minTicketCents ?? 0,
            targetTicketCents: goal?.targetTicketCents ?? 0,
          };
        })
      );

      setUnitSummaries(summaries);

      // Buscar gráfico por hora
      const rawHourly = await Api.reportCheckinsByHour(null, todayStr, todayStr).catch(
        () => []
      );

      // Pivotar por hora (das 10h às 22h)
      const hoursMap = new Map<number, Record<string, number>>();
      for (let h = 10; h <= 22; h++) {
        hoursMap.set(h, {});
      }

      for (const row of rawHourly) {
        const h = row.hour;
        if (hoursMap.has(h)) {
          const current = hoursMap.get(h)!;
          current[row.unit_name] = (current[row.unit_name] ?? 0) + row.count;
        }
      }

      const formattedHourly: HourlyProgressData[] = Array.from(hoursMap.entries()).map(
        ([hour, unitCounts]) => {
          let sum = 0;
          const entry: HourlyProgressData = {
            hourLabel: `${hour}h`,
            total: 0,
          };

          for (const u of units) {
            const count = unitCounts[u.name] ?? 0;
            entry[u.name] = count;
            sum += count;
          }
          entry.total = sum;
          return entry;
        }
      );

      setHourlyData(formattedHourly);
      setLastUpdated(
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
    } catch (err) {
      console.error("Erro ao carregar Dashboard Flutuante OWNER:", err);
    } finally {
      setLoading(false);
    }
  }, [isOwner, units]);

  useEffect(() => {
    if (isOwner) {
      loadDashboardData();
      const interval = setInterval(loadDashboardData, 60000); // 1 minuto
      return () => clearInterval(interval);
    }
  }, [isOwner, loadDashboardData]);

  if (!isOwner) return null;

  // Filtragem dos dados exibidos no card principal
  const activeSummary =
    selectedUnitId === "ALL"
      ? {
          revenueCents: totalRevenueCents,
          sessionsCount: totalSessionsCount,
          ticketMedioCents: overallTicketMedioCents,
          minTicketCents: Math.round(
            unitSummaries.reduce((a, b) => a + b.minTicketCents, 0) /
              (unitSummaries.length || 1)
          ),
          targetTicketCents: Math.round(
            unitSummaries.reduce((a, b) => a + b.targetTicketCents, 0) /
              (unitSummaries.length || 1)
          ),
        }
      : unitSummaries.find((u) => u.unitId === selectedUnitId) ?? {
          revenueCents: 0,
          sessionsCount: 0,
          ticketMedioCents: 0,
          minTicketCents: 0,
          targetTicketCents: 0,
        };

  // Status visual do Ticket Médio — reaproveita a paleta de semáforo
  // operacional (packages/ui/src/tokens/status.css), a mesma usada no
  // resto do quiosque para "bom / atenção / ruim", em vez de inventar
  // uma escala de cor nova só para este painel.
  const ticketStatus =
    activeSummary.targetTicketCents > 0
      ? activeSummary.ticketMedioCents >= activeSummary.targetTicketCents
        ? { label: "Meta atingida", bg: "var(--status-verde-soft)", fg: "var(--status-verde-text)" }
        : activeSummary.ticketMedioCents >= activeSummary.minTicketCents
        ? { label: "Na média", bg: "var(--status-amarelo-soft)", fg: "var(--status-amarelo-text)" }
        : { label: "Abaixo do alvo", bg: "var(--status-vermelho-soft)", fg: "var(--status-vermelho-text)" }
      : { label: "Meta não definida", bg: "var(--surface-raised)", fg: "var(--text-muted)" };

  // Dica Comercial Automatizada para Alavancar Vendas
  const getSmartCommercialInsight = () => {
    if (activeSummary.ticketMedioCents < activeSummary.targetTicketCents) {
      const diff = activeSummary.targetTicketCents - activeSummary.ticketMedioCents;
      return {
        title: "Oportunidade de alavancagem do ticket médio",
        message: `Seu ticket médio atual está ${money(diff)} abaixo da meta. Oriente os operadores a venderem meias antiderrapantes e fazerem o upgrade de tempo (+15min/30min) no check-in para bater a meta do dia!`,
      };
    }
    return {
      title: "Excelente desempenho de vendas",
      message:
        "O ticket médio hoje está atingindo o valor ideal. Continue estimulando a equipe do caixa para vendas complementares de snacks e brindes no check-out.",
    };
  };

  const insight = getSmartCommercialInsight();

  // 1. Caso esteja totalmente fechado
  if (!isOpen) {
    return (
      <Button
        variant="dark"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        style={{
          position: "fixed",
          bottom: "var(--space-6)",
          right: "var(--space-6)",
          zIndex: 999,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <ChartBarIcon aria-hidden="true" />
        Dashboard OWNER
      </Button>
    );
  }

  // 2. Caso esteja minimizado (widget flutuante)
  if (isMinimized) {
    return (
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        aria-label={`Expandir Dashboard OWNER. Faturamento de hoje: ${money(totalRevenueCents)}, ${totalSessionsCount} visitas.`}
        style={{
          position: "fixed",
          bottom: "var(--space-6)",
          right: "var(--space-6)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-full)",
          padding: "var(--space-2) var(--space-3) var(--space-2) var(--space-4)",
          minHeight: "44px",
          boxShadow: "var(--shadow-lg)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px" }}>
          <span
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-bold)" as unknown as number,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-wide)",
            }}
          >
            OWNER · hoje
          </span>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-teal-text)" }}>
            {money(totalRevenueCents)}{" "}
            <span style={{ color: "var(--text-secondary)", fontWeight: "var(--weight-medium)" as unknown as number }}>
              ({totalSessionsCount} vis.)
            </span>
          </span>
        </span>

        <span
          aria-hidden="true"
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "var(--radius-circle)",
            background: "var(--color-teal)",
            color: "var(--text-on-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ChartBarIcon />
        </span>
      </button>
    );
  }

  // 3. Caso esteja aberto — reaproveita o Modal compartilhado (foco preso,
  // Escape para fechar, devolução de foco, role="dialog") em vez do overlay
  // artesanal anterior, igual aos outros diálogos do produto.
  const modalTitle = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)" }}>
      <span
        aria-hidden="true"
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-teal)",
          color: "var(--text-on-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <ChartBarIcon style={{ fontSize: "20px" }} />
      </span>
      <span>
        Painel de Gestão OWNER
        <span
          style={{
            marginLeft: "8px",
            display: "inline-block",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-bold)" as unknown as number,
            padding: "2px 8px",
            borderRadius: "var(--radius-full)",
            background: "var(--status-verde-soft)",
            color: "var(--status-verde-text)",
          }}
        >
          AO VIVO{lastUpdated ? ` · ${lastUpdated}` : ""}
        </span>
      </span>
    </span>
  );

  return (
    <Modal title={modalTitle} onClose={() => setIsOpen(false)} maxWidth="960px" zIndex={1000}>
      <div style={{ fontFamily: "var(--font-body)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {/* BARRA DE AÇÕES */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Acompanhamento em tempo real de vendas, fluxo e ticket médio
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Button variant="ghost" size="sm" onClick={loadDashboardData} disabled={loading}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {loading ? "Atualizando…" : "Atualizar"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsMinimized(true)}>
              Minimizar
            </Button>
          </div>
        </div>

        {/* SELETOR DE UNIDADE */}
        <div role="group" aria-label="Filtrar unidade" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", overflowX: "auto", paddingBottom: "2px" }}>
          <button
            type="button"
            onClick={() => setSelectedUnitId("ALL")}
            aria-pressed={selectedUnitId === "ALL"}
            style={unitTabStyle(selectedUnitId === "ALL")}
          >
            Visão consolidada ({units.length} {units.length === 1 ? "unidade" : "unidades"})
          </button>
          {units.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelectedUnitId(u.id)}
              aria-pressed={selectedUnitId === u.id}
              style={unitTabStyle(selectedUnitId === u.id)}
            >
              {u.name}
            </button>
          ))}
        </div>

        {/* PAINEL DE MÉTRICAS (4 CARDS) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
          <Card bodyStyle={{ display: "flex", flexDirection: "column" }}>
            <MetricHeader label="Faturamento acumulado" icon={<WalletIcon aria-hidden="true" />} accent="var(--color-teal)" />
            <MetricValue color="var(--color-teal-text)">{money(activeSummary.revenueCents)}</MetricValue>
            <MetricNote>Hoje no dia operacional</MetricNote>
          </Card>

          <Card bodyStyle={{ display: "flex", flexDirection: "column" }}>
            <MetricHeader label="Sessões / crianças" icon={<GridIcon aria-hidden="true" />} accent="var(--color-primary-hover)" />
            <MetricValue color="var(--color-primary-hover)">
              {activeSummary.sessionsCount}{" "}
              <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" as unknown as number, color: "var(--text-muted)" }}>
                atendimentos
              </span>
            </MetricValue>
            <MetricNote>Total de visitas registradas</MetricNote>
          </Card>

          <Card bodyStyle={{ display: "flex", flexDirection: "column" }}>
            <MetricHeader label="Ticket médio" icon={<ChartBarIcon aria-hidden="true" />} accent={ticketStatus.fg} />
            <MetricValue color={ticketStatus.fg}>{money(activeSummary.ticketMedioCents)}</MetricValue>
            <span
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "2px 10px",
                borderRadius: "var(--radius-full)",
                background: ticketStatus.bg,
                color: ticketStatus.fg,
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-bold)" as unknown as number,
              }}
            >
              {ticketStatus.label}
            </span>
          </Card>

          <Card bodyStyle={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <MetricHeader label="Meta da unidade" icon={<WalletIcon aria-hidden="true" />} accent="var(--color-amber)" />
            <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" as unknown as number, color: "var(--text-primary)" }}>
              Mínimo: {money(activeSummary.minTicketCents)}
            </span>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" as unknown as number, color: "var(--color-teal-text)" }}>
              Alvo: {money(activeSummary.targetTicketCents)}
            </span>
          </Card>
        </div>

        {/* GRÁFICO DE PROGRESSO DIÁRIO POR HORA */}
        <div
          style={{
            padding: "var(--space-5)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "var(--space-2)" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--text-primary)" }}>
              Progresso diário de atendimentos por hora (check-ins)
            </h3>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Das 10h às 22h</span>
          </div>

          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              {selectedUnitId === "ALL" && units.length > 1 ? (
                <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="hourLabel" stroke="var(--text-muted)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
                  {units.map((u, i) => (
                    <Bar
                      key={u.id}
                      dataKey={u.name}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={18}
                    />
                  ))}
                </BarChart>
              ) : (
                <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    {/* Cor fixa igual a --color-teal: defs de gradiente SVG
                        não resolvem var() em stop-color. */}
                    <linearGradient id="ownerHourlyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2ECFB5" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#2ECFB5" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="hourLabel" stroke="var(--text-muted)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val} check-ins`, "Fluxo"]} />
                  <Area
                    type="monotone"
                    dataKey={selectedUnitId === "ALL" ? "total" : units.find((u) => u.id === selectedUnitId)?.name ?? "total"}
                    stroke="var(--color-teal)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#ownerHourlyGrad)"
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* DETALHAMENTO DE DESEMPENHO POR UNIDADE (VISÃO CONSOLIDADA) */}
        {selectedUnitId === "ALL" && units.length > 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
            {unitSummaries.map((u) => (
              <Card key={u.unitId} bodyStyle={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--text-primary)" }}>
                    {u.unitName}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedUnitId(u.unitId)}>
                    Filtrar
                  </Button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                  <div>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Faturamento</span>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-teal-text)" }}>
                      {money(u.revenueCents)}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Ticket médio</span>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-primary-hover)" }}>
                      {money(u.ticketMedioCents)}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* PAINEL DE ESTRATÉGIA E ALAVANCAGEM COMERCIAL */}
        <div
          style={{
            padding: "var(--space-4) var(--space-5)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            borderLeft: "4px solid var(--color-teal)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <h4 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-teal-text)" }}>
            {insight.title}
          </h4>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-normal)" }}>
            {insight.message}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function unitTabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    minHeight: "40px",
    borderRadius: "var(--radius-full)",
    border: `1px solid ${active ? "var(--color-teal)" : "var(--border-subtle)"}`,
    background: active ? "rgba(46, 207, 181, 0.12)" : "transparent",
    color: active ? "var(--color-teal-text)" : "var(--text-secondary)",
    fontFamily: "var(--font-body)",
    fontWeight: (active ? "var(--weight-bold)" : "var(--weight-medium)") as unknown as number,
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}

function MetricHeader({ label, icon, accent }: { label: string; icon: React.ReactNode; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
      <span
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-bold)" as unknown as number,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-wide)",
        }}
      >
        {label}
      </span>
      <span style={{ color: accent, display: "flex", fontSize: "16px" }}>{icon}</span>
    </div>
  );
}

function MetricValue({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ display: "block", fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)" as unknown as number, color, marginBottom: "4px" }}>
      {children}
    </span>
  );
}

function MetricNote({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{children}</span>;
}
