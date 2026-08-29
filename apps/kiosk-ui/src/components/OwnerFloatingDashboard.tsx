import React, { useEffect, useState, useCallback } from "react";
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
import { Button } from "@facaamigos/ui";
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

const CHART_COLORS = ["#2ECFB5", "#6366F1", "#F59E0B", "#EC4899", "#10B981", "#8B5CF6"];

const tooltipStyle = {
  background: "#1E293B",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  borderRadius: "8px",
  boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
  color: "#F8FAFC",
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
  const [selectedUnitId, setSelectedUnitId] = useState<string>("ALL"); // 'ALL' = Consolidado (fallback até 1ª unidade carregar)

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

      // Buscar gráfico de fluxo/sessões por hora de todas as unidades
      const rawHourly = await Api.reportCheckinsByHour(null, todayStr, todayStr).catch(
        () => []
      );

      const checkinCountByUnit = new Map<string, number>();
      for (const row of rawHourly) {
        const key = row.unit_id || row.unit_name;
        checkinCountByUnit.set(key, (checkinCountByUnit.get(key) ?? 0) + row.count);
      }

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

          const checkinsCount = checkinCountByUnit.get(u.id) ?? checkinCountByUnit.get(u.name) ?? 0;
          const sessionsCount = checkinsCount > 0 ? checkinsCount : tm.ordersCount;
          const revenueCents = Math.max(rev.totalCents, tm.totalCents);
          const ticketMedioCents =
            tm.avgCents > 0
              ? tm.avgCents
              : sessionsCount > 0 && revenueCents > 0
              ? Math.round(revenueCents / sessionsCount)
              : 0;

          return {
            unitId: u.id,
            unitName: u.name,
            revenueCents,
            sessionsCount,
            ticketMedioCents,
            minTicketCents: goal?.minTicketCents ?? 0,
            targetTicketCents: goal?.targetTicketCents ?? 0,
          };
        })
      );

      setUnitSummaries(summaries);

      // Pivotar por hora (padrão 08h às 22h, expandindo dinamicamente se houver sessões fora dessa faixa)
      let startHour = 8;
      let endHour = 22;
      for (const row of rawHourly) {
        if (typeof row.hour === "number") {
          if (row.hour < startHour) startHour = Math.max(0, row.hour);
          if (row.hour > endHour) endHour = Math.min(23, row.hour);
        }
      }

      const hoursMap = new Map<number, Record<string, number>>();
      for (let h = startHour; h <= endHour; h++) {
        hoursMap.set(h, {});
      }

      for (const row of rawHourly) {
        const h = row.hour;
        if (hoursMap.has(h)) {
          const current = hoursMap.get(h)!;
          const matchedUnit = units.find((u) => u.id === row.unit_id || u.name === row.unit_name);
          const uName = matchedUnit ? matchedUnit.name : row.unit_name;
          current[uName] = (current[uName] ?? 0) + row.count;
        }
      }

      const formattedHourly: HourlyProgressData[] = Array.from(hoursMap.entries()).map(
        ([hour, unitCounts]) => {
          let sum = 0;
          const entry: HourlyProgressData = {
            hourLabel: `${String(hour).padStart(2, "0")}h`,
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

  // Status visual do Ticket Médio (Acima da meta / Atenção / Abaixo da meta)
  const ticketStatus =
    activeSummary.targetTicketCents > 0
      ? activeSummary.ticketMedioCents >= activeSummary.targetTicketCents
        ? { label: "Meta Atingida 🎉", color: "#10B981", bg: "rgba(16, 185, 129, 0.15)" }
        : activeSummary.ticketMedioCents >= activeSummary.minTicketCents
        ? { label: "Aparado na Média 🟡", color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)" }
        : { label: "Abaixo do Alvo 🔴", color: "#EF4444", bg: "rgba(239, 68, 68, 0.15)" }
      : { label: "Meta Não Definida", color: "#94A3B8", bg: "rgba(148, 163, 184, 0.1)" };

  // Dica Comercial Automatizada para Alavancar Vendas
  const getSmartCommercialInsight = () => {
    if (activeSummary.ticketMedioCents < activeSummary.targetTicketCents) {
      const diff = activeSummary.targetTicketCents - activeSummary.ticketMedioCents;
      return {
        title: "⚡ Oportunidade de Alavancagem do Ticket Médio",
        message: `Seu ticket médio atual está ${money(diff)} abaixo da meta. Oriente os operadores a venderem meias antiderrapantes e fazerem o upgrade de tempo (+15min/30min) no check-in para bater a meta do dia!`,
        action: "Incentivar Combo Tempo Extra + Meias",
      };
    }
    return {
      title: "🚀 Excelente Desempenho de Vendas!",
      message:
        "O ticket médio hoje está atingindo o valor ideal. Continue estimulando a equipe do caixa para vendas complementares de snacks e brindes no check-out.",
      action: "Manter Ritmo Comercial",
    };
  };

  const insight = getSmartCommercialInsight();

  // 1. Caso esteja totalmente fechado
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        title="Abrir Dashboard OWNER"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 999,
          padding: "10px 16px",
          borderRadius: "9999px",
          background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
          color: "#2ECFB5",
          border: "1px solid rgba(46, 207, 181, 0.4)",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
          fontWeight: 700,
          fontSize: "13px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span>👑 Dashboard OWNER</span>
      </button>
    );
  }

  // 2. Caso esteja minimizado (Widget FAB Flutuante)
  if (isMinimized) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "rgba(15, 23, 42, 0.92)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(46, 207, 181, 0.4)",
          padding: "8px 16px",
          borderRadius: "9999px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
          color: "#F8FAFC",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "11px", color: "#94A3B8", fontWeight: 600 }}>
            👑 OWNER · Hoje
          </span>
          <span style={{ fontSize: "13px", color: "#2ECFB5", fontWeight: 800 }}>
            {money(totalRevenueCents)} <span style={{ color: "#CBD5E1", fontWeight: 500 }}>({totalSessionsCount} vis.)</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          title="Expandir Dashboard"
          style={{
            background: "rgba(46, 207, 181, 0.15)",
            border: "1px solid rgba(46, 207, 181, 0.3)",
            color: "#2ECFB5",
            borderRadius: "50%",
            width: "32px",
            height: "32px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: "14px",
          }}
        >
          ⤢
        </button>
      </div>
    );
  }

  // 3. Caso esteja aberto (Modal Flutuante Central)
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(2, 6, 23, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#0F172A",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "20px",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7)",
          color: "#F8FAFC",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* CABEÇALHO */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            background: "linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #2ECFB5 0%, #0D9488 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                boxShadow: "0 4px 14px rgba(46, 207, 181, 0.3)",
              }}
            >
              👑
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#FFFFFF" }}>
                  Painel de Gestão OWNER
                </h2>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "rgba(46, 207, 181, 0.15)",
                    color: "#2ECFB5",
                    border: "1px solid rgba(46, 207, 181, 0.3)",
                    fontWeight: 700,
                  }}
                >
                  LIVE {lastUpdated ? `· ${lastUpdated}` : ""}
                </span>
              </div>
              <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                Acompanhamento em tempo real de vendas, fluxo e ticket médio
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDashboardData}
              disabled={loading}
              style={{
                color: "#94A3B8",
                borderColor: "rgba(255, 255, 255, 0.1)",
                fontSize: "12px",
              }}
            >
              {loading ? "Carregando…" : "🔄 Atualizar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(true)}
              title="Minimizar para botão flutuante"
              style={{
                color: "#CBD5E1",
                borderColor: "rgba(255, 255, 255, 0.1)",
                fontSize: "12px",
              }}
            >
              ➖ Minimizar
            </Button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="Fechar Dashboard"
              style={{
                background: "transparent",
                border: "none",
                color: "#64748B",
                fontSize: "20px",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "6px",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* CONTROLES / SELETOR DE UNIDADE */}
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            background: "#1E293B",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            overflowX: "auto",
          }}
        >
          <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 700, marginRight: "4px" }}>
            Filtrar Unidade:
          </span>
          {units.length > 1 && (
            <button
              type="button"
              onClick={() => setSelectedUnitId("ALL")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: selectedUnitId === "ALL" ? "#2ECFB5" : "rgba(255, 255, 255, 0.1)",
                background: selectedUnitId === "ALL" ? "rgba(46, 207, 181, 0.15)" : "transparent",
                color: selectedUnitId === "ALL" ? "#2ECFB5" : "#CBD5E1",
                fontWeight: selectedUnitId === "ALL" ? 700 : 500,
                fontSize: "13px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              🌐 Consolidado (Todas)
            </button>
          )}
          {units.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelectedUnitId(u.id)}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: selectedUnitId === u.id ? "#2ECFB5" : "rgba(255, 255, 255, 0.1)",
                background: selectedUnitId === u.id ? "rgba(46, 207, 181, 0.15)" : "transparent",
                color: selectedUnitId === u.id ? "#2ECFB5" : "#CBD5E1",
                fontWeight: selectedUnitId === u.id ? 700 : 500,
                fontSize: "13px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              📍 {u.name}
            </button>
          ))}
        </div>

        {/* CONTEÚDO PRINCIPAL */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* PAINEL DE METRICAS (4 CARDS) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            {/* Card 1: Faturamento */}
            <div
              style={{
                padding: "16px",
                borderRadius: "14px",
                background: "rgba(30, 41, 59, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>
                  Faturamento Acumulado Diário
                </span>
                <span style={{ fontSize: "16px" }}>💰</span>
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "#2ECFB5" }}>
                {money(activeSummary.revenueCents)}
              </span>
              <span style={{ fontSize: "11px", color: "#64748B" }}>
                {selectedUnitId === "ALL" ? "Total diário acumulado de todas as unidades" : "Acumulado hoje no dia operacional"}
              </span>
            </div>

            {/* Card 2: Sessões / Crianças */}
            <div
              style={{
                padding: "16px",
                borderRadius: "14px",
                background: "rgba(30, 41, 59, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>
                  Sessões / Crianças
                </span>
                <span style={{ fontSize: "16px" }}>👧</span>
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "#818CF8" }}>
                {activeSummary.sessionsCount}{" "}
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#94A3B8" }}>
                  atendimentos
                </span>
              </span>
              <span style={{ fontSize: "11px", color: "#64748B" }}>Total de visitas registradas</span>
            </div>

            {/* Card 3: Ticket Médio */}
            <div
              style={{
                padding: "16px",
                borderRadius: "14px",
                background: "rgba(30, 41, 59, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>
                  Ticket Médio
                </span>
                <span style={{ fontSize: "16px" }}>🎟️</span>
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: ticketStatus.color }}>
                {money(activeSummary.ticketMedioCents)}
              </span>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  padding: "2px 8px",
                  borderRadius: "9999px",
                  background: ticketStatus.bg,
                  color: ticketStatus.color,
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {ticketStatus.label}
              </div>
            </div>

            {/* Card 4: Meta de Ticket Alvo */}
            <div
              style={{
                padding: "16px",
                borderRadius: "14px",
                background: "rgba(30, 41, 59, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>
                  Meta da Unidade
                </span>
                <span style={{ fontSize: "16px" }}>🎯</span>
              </div>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#F8FAFC" }}>
                Mínimo: {money(activeSummary.minTicketCents)}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#2ECFB5" }}>
                Alvo: {money(activeSummary.targetTicketCents)}
              </span>
            </div>
          </div>

          {/* GRÁFICO DE PROGRESSO DIÁRIO POR HORA (MINIMALISTA) */}
          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "rgba(15, 23, 42, 0.4)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Fluxo por Hora
                </span>
                <span style={{ fontSize: "11px", color: "#64748B" }}>
                  Sessões e check-ins de entrada registrados por hora local
                </span>
              </div>
            </div>

            <div style={{ width: "100%", height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                {selectedUnitId === "ALL" && units.length > 1 ? (
                  <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.03)" vertical={false} />
                    <XAxis dataKey="hourLabel" stroke="#475569" fontSize={11} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94A3B8" }} />
                    {units.map((u, i) => (
                      <Bar
                        key={u.id}
                        dataKey={u.name}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={16}
                      />
                    ))}
                  </BarChart>
                ) : (
                  <AreaChart data={hourlyData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ownerHourlyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2ECFB5" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#2ECFB5" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.03)" vertical={false} />
                    <XAxis dataKey="hourLabel" stroke="#475569" fontSize={11} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val}`, "Atendimentos"]} />
                    <Area
                      type="monotone"
                      dataKey={selectedUnitId === "ALL" ? "total" : units.find((u) => u.id === selectedUnitId)?.name ?? "total"}
                      stroke="#2ECFB5"
                      strokeWidth={2.5}
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "12px",
              }}
            >
              {unitSummaries.map((u) => (
                <div
                  key={u.unitId}
                  style={{
                    padding: "14px 16px",
                    borderRadius: "12px",
                    background: "rgba(30, 41, 59, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#F8FAFC" }}>
                      📍 {u.unitName}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUnitId(u.unitId)}
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                    >
                      Filtrar
                    </Button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    <div>
                      <span style={{ fontSize: "11px", color: "#94A3B8" }}>Fat. Acumulado</span>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#2ECFB5" }}>
                        {money(u.revenueCents)}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#94A3B8" }}>Sessões</span>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#F8FAFC" }}>
                        {u.sessionsCount}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#94A3B8" }}>Ticket Médio</span>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#818CF8" }}>
                        {money(u.ticketMedioCents)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PAINEL DE ESTRATÉGIA E ALAVANCAGEM COMERCIAL */}
          <div
            style={{
              padding: "16px 20px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)",
              border: "1px solid rgba(46, 207, 181, 0.25)",
              display: "flex",
              alignItems: "flex-start",
              gap: "14px",
            }}
          >
            <div style={{ fontSize: "24px" }}>💡</div>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 700, color: "#2ECFB5" }}>
                {insight.title}
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "#CBD5E1", lineHeight: 1.5 }}>
                {insight.message}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
