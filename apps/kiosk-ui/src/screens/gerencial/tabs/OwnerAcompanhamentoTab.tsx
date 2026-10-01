import { useEffect, useState } from "react";
import { Card, Button, Badge, HelpText, Select } from "@facaamigos/ui";
import { useAppState } from "../../../state/AppState.js";
import { Api, businessDateFor } from "../../../api/client.js";
import { money } from "../../../format.js";
import { supabase } from "../../../lib/supabase/client.js";
import { averageScore, summarizeNps } from "../../../lib/nps.js";

interface UnitMetric {
  unitId: string;
  unitName: string;
  kind: string;
  goalCents: number;
  revenueCents: number;
  ordersCount: number;
  activeSessionsCount: number;
  overdueSessionsCount: number;
}

interface NpsLogItem {
  id: string;
  code: string;
  playgroundScore: number | null;
  circuitoScore: number | null;
  teamScore?: number | null;
  spaceScore?: number | null;
  feedback: string;
  activity: string | null;
  createdAt: string;
}

export function OwnerAcompanhamentoTab() {
  const { units } = useAppState();
  const [selectedUnitId, setSelectedUnitId] = useState<string>("ALL");
  const [unitMetrics, setUnitMetrics] = useState<UnitMetric[]>([]);
  const [npsLogs, setNpsLogs] = useState<NpsLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  async function loadDashboardData() {
    setLoading(true);
    try {
      // 1. Carrega Métricas das Unidades
      const metrics: UnitMetric[] = await Promise.all(
        units.map(async (unit) => {
          const cutoff = unit.business_day_cutoff_hour;
          const [goalCents, revenue, ticketMedio] = await Promise.all([
            Api.todayGoal(unit.id, cutoff).catch(() => 0),
            Api.todayRevenue(unit.id, cutoff).catch(() => ({ totalCents: 0 })),
            Api.todayTicketMedio(unit.id, cutoff).catch(() => ({ ordersCount: 0 })),
          ]);

          // Tenta buscar sessões ativas no Supabase
          let activeSessionsCount = 0;
          let overdueSessionsCount = 0;
          try {
            const { data: sessoes } = await supabase()
              .from("sessions")
              .select("id, status, duration_minutes, created_at")
              .eq("unit_id", unit.id)
              .in("status", ["ATIVA", "PAUSADA"]);

            if (sessoes) {
              activeSessionsCount = sessoes.length;
              const nowMs = Date.now();
              overdueSessionsCount = sessoes.filter((s) => {
                const createdMs = new Date(s.created_at).getTime();
                const durMs = (s.duration_minutes || 30) * 60_000;
                return nowMs > createdMs + durMs;
              }).length;
            }
          } catch {}

          return {
            unitId: unit.id,
            unitName: unit.name,
            kind: unit.kind,
            goalCents: goalCents || 0,
            revenueCents: revenue.totalCents || 0,
            ordersCount: ticketMedio.ordersCount || 0,
            activeSessionsCount,
            overdueSessionsCount,
          };
        })
      );
      setUnitMetrics(metrics);

      // 2. Carrega histórico recente de NPS via fa_acompanhar_eventos ou rpc se existir
      try {
        const { data: npsData } = await supabase()
          .from("fa_acompanhar_eventos")
          .select("id, code, kind, payload, created_at")
          .eq("kind", "AVALIACAO_NPS")
          .order("created_at", { ascending: false })
          .limit(20);

        if (npsData) {
          const parsed: NpsLogItem[] = npsData.map((item) => {
            const payload = (item.payload || {}) as Record<string, unknown>;
            return {
              id: String(item.id),
              code: String(item.code || ""),
              playgroundScore: typeof payload.playgroundScore === "number" ? payload.playgroundScore : null,
              circuitoScore: typeof payload.circuitoScore === "number" ? payload.circuitoScore : null,
              feedback: typeof payload.feedback === "string" ? payload.feedback : "",
              activity: typeof payload.activity === "string" ? payload.activity : null,
              createdAt: String(item.created_at || ""),
            };
          });
          setNpsLogs(parsed);
        }
      } catch {
        // Tabela/RPC pode não ter permissão anon ou estar vazia
      }

      // 3. NPS respondido por WhatsApp (CRM) — a pesquisa saiu da tela de
      // acompanhamento do responsável, então as notas novas chegam por aqui.
      try {
        const crm = await Api.crmNpsFeed(20);
        const fromCrm: NpsLogItem[] = crm.map((r) => {
          const circuito = r.brand.toLowerCase().includes("circuito");
          return {
            id: `crm-${r.id}`,
            code: `WhatsApp · ${r.brand}`,
            playgroundScore: circuito ? null : r.score,
            circuitoScore: circuito ? r.score : null,
            teamScore: r.score_team,
            spaceScore: r.score_space,
            feedback: r.feedback ?? "",
            activity: circuito ? "CARRINHO" : "PLAYGROUND",
            createdAt: new Date(Number(r.scored_at_ms)).toISOString(),
          };
        });
        setNpsLogs((prev) =>
          [...prev, ...fromCrm].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30),
        );
      } catch {
        // sem permissão de CRM ou migration ainda não aplicada: mantém só o histórico antigo
      }
    } catch (err) {
      console.error("Erro ao carregar dados do painel do Owner:", err);
    } finally {
      setLoading(false);
      setLastRefreshed(new Date());
    }
  }

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30_000); // Auto-refresh a cada 30s
    return () => clearInterval(interval);
  }, [units]);

  const filteredMetrics = selectedUnitId === "ALL"
    ? unitMetrics
    : unitMetrics.filter((m) => m.unitId === selectedUnitId);

  const totalRevenue = filteredMetrics.reduce((acc, m) => acc + m.revenueCents, 0);
  const totalGoal = filteredMetrics.reduce((acc, m) => acc + m.goalCents, 0);
  const totalOrders = filteredMetrics.reduce((acc, m) => acc + m.ordersCount, 0);
  const totalActiveSessions = filteredMetrics.reduce((acc, m) => acc + m.activeSessionsCount, 0);
  const totalOverdueSessions = filteredMetrics.reduce((acc, m) => acc + m.overdueSessionsCount, 0);

  const goalPercent = totalGoal > 0 ? Math.min(100, Math.round((totalRevenue / totalGoal) * 100)) : null;

  // Cálculo de média NPS
  const validScores = npsLogs.flatMap((n) => [n.playgroundScore, n.circuitoScore].filter((s): s is number => s !== null));
  const avgNps = validScores.length > 0
    ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1)
    : null;
  const npsSummary = summarizeNps(validScores);
  const avgTeam = averageScore(npsLogs.flatMap((n) => (n.teamScore != null ? [n.teamScore] : [])));
  const avgSpace = averageScore(npsLogs.flatMap((n) => (n.spaceScore != null ? [n.spaceScore] : [])));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "8px 0 32px" }}>
      {/* Header do Painel Owner */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#ffffff",
          padding: "20px 24px",
          borderRadius: "16px",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.15)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span
              style={{
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: "bold",
                padding: "3px 10px",
                borderRadius: "9999px",
                letterSpacing: "0.5px",
              }}
            >
              👑 PAINEL OWNER
            </span>
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>
              Atualizado às {lastRefreshed.toLocaleTimeString("pt-BR")}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: "22px", fontFamily: "var(--font-display)", color: "#f8fafc" }}>
            Visualização & Acompanhamento Geral
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "200px" }}>
            <Select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              style={{ background: "#334155", color: "#ffffff", borderColor: "#475569" }}
            >
              <option value="ALL">Todas as 3 Unidades</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" onClick={loadDashboardData} disabled={loading}>
            {loading ? "Atualizando..." : "🔄 Atualizar"}
          </Button>
        </div>
      </div>

      {/* Grid de KPIs Superiores */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        {/* Card Faturamento vs Meta */}
        <Card style={{ padding: "20px", borderLeft: "4px solid #0d9488" }}>
          <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>
            Faturamento Consolidado
          </span>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#0f172a", margin: "6px 0 2px" }}>
            {money(totalRevenue)}
          </div>
          {totalGoal > 0 ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#475569", marginBottom: "4px" }}>
                <span>Meta: {money(totalGoal)}</span>
                <strong>{goalPercent}%</strong>
              </div>
              <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${goalPercent}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #0d9488 0%, #10b981 100%)",
                  }}
                />
              </div>
            </div>
          ) : (
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>Sem meta configurada</span>
          )}
        </Card>

        {/* Card Total de Vendas */}
        <Card style={{ padding: "20px", borderLeft: "4px solid #3b82f6" }}>
          <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>
            Total de Vendas / Ingressos
          </span>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#0f172a", margin: "6px 0 2px" }}>
            {totalOrders}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Atendimentos registrados hoje</span>
        </Card>

        {/* Card Sessões Ativas Agora */}
        <Card style={{ padding: "20px", borderLeft: "4px solid #8b5cf6" }}>
          <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>
            Crianças Brincando Agora
          </span>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#0f172a", margin: "6px 0 2px" }}>
            {totalActiveSessions}
          </div>
          {totalOverdueSessions > 0 ? (
            <span style={{ fontSize: "12px", fontWeight: "bold", color: "#ef4444" }}>
              ⚠️ {totalOverdueSessions} com tempo excedido
            </span>
          ) : (
            <span style={{ fontSize: "12px", color: "#10b981" }}>✓ Todas no prazo</span>
          )}
        </Card>

        {/* Card Média NPS */}
        <Card style={{ padding: "20px", borderLeft: "4px solid #f59e0b" }}>
          <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>
            NPS
          </span>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#0f172a", margin: "6px 0 2px" }}>
            {npsSummary.nps !== null ? (npsSummary.nps > 0 ? `+${npsSummary.nps}` : npsSummary.nps) : "—"}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            {npsLogs.length} avaliações · nota média {avgNps ?? "—"}/10
            {avgTeam !== null && ` · equipe ${avgTeam.toFixed(1)}/5`}
            {avgSpace !== null && ` · espaço ${avgSpace.toFixed(1)}/5`}
          </span>
        </Card>
      </div>

      {/* Detalhamento por Unidade */}
      <div>
        <h3 style={{ fontSize: "17px", color: "#0f172a", fontFamily: "var(--font-display)", marginBottom: "12px" }}>
          Acompanhamento por Operação
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
          {filteredMetrics.map((m) => {
            const unitGoalPercent = m.goalCents > 0 ? Math.min(100, Math.round((m.revenueCents / m.goalCents) * 100)) : null;
            return (
              <Card key={m.unitId} style={{ padding: "18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <strong style={{ fontSize: "16px", color: "#0f172a" }}>{m.unitName}</strong>
                  <Badge variant={m.kind === "QUIOSQUE" ? "vip" : "teal"}>
                    {m.kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND"}
                  </Badge>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                    <span style={{ color: "#64748b" }}>Faturamento:</span>
                    <strong style={{ color: "#0f172a" }}>{money(m.revenueCents)}</strong>
                  </div>

                  {m.goalCents > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ color: "#64748b" }}>Meta ({money(m.goalCents)}):</span>
                      <strong style={{ color: unitGoalPercent && unitGoalPercent >= 100 ? "#10b981" : "#0d9488" }}>
                        {unitGoalPercent}% Atingido
                      </strong>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <span style={{ color: "#64748b" }}>Vendas Realizadas:</span>
                    <strong>{m.ordersCount} pedidos</strong>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <span style={{ color: "#64748b" }}>Sessões Ativas:</span>
                    <span>
                      <strong>{m.activeSessionsCount} ativas</strong>
                      {m.overdueSessionsCount > 0 && (
                        <span style={{ color: "#ef4444", fontWeight: "bold", marginLeft: "6px" }}>
                          ({m.overdueSessionsCount} excedidas)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Feed de Avaliações NPS dos Clientes */}
      <Card style={{ padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "17px", color: "#0f172a", fontFamily: "var(--font-display)" }}>
              💬 Feed de Avaliações NPS (Playground & Circuito)
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#64748b" }}>
              Feed ao vivo das notas de 0 a 10 e opiniões enviadas pelos responsáveis ao término da sessão.
            </p>
          </div>
          {avgNps !== null && (
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "20px", fontWeight: "bold", color: "#0d9488" }}>{avgNps} / 10</span>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Nota Global Média</div>
            </div>
          )}
        </div>

        {npsLogs.length === 0 ? (
          <HelpText style={{ textAlign: "center", padding: "24px 0" }}>
            Nenhuma avaliação NPS registrada hoje ainda. As notas respondidas pelos clientes na pesquisa de NPS do WhatsApp (CRM) aparecerão aqui. 🌟
          </HelpText>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {npsLogs.map((log) => {
              const maxScore = Math.max(log.playgroundScore ?? -1, log.circuitoScore ?? -1);
              let scoreBadgeBg = "#e2e8f0";
              let scoreBadgeColor = "#334155";
              let scoreLabel = "Neutro";

              if (maxScore >= 9) {
                scoreBadgeBg = "#dcfce7";
                scoreBadgeColor = "#15803d";
                scoreLabel = "Promotor ⭐";
              } else if (maxScore >= 7) {
                scoreBadgeBg = "#fef3c7";
                scoreBadgeColor = "#b45309";
                scoreLabel = "Neutro";
              } else if (maxScore >= 0) {
                scoreBadgeBg = "#fee2e2";
                scoreBadgeColor = "#b91c1c";
                scoreLabel = "Detrator";
              }

              return (
                <div
                  key={log.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: "12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          background: scoreBadgeBg,
                          color: scoreBadgeColor,
                          fontWeight: "bold",
                          fontSize: "12px",
                          padding: "2px 8px",
                          borderRadius: "6px",
                        }}
                      >
                        {scoreLabel}
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        Código: <strong>{log.code}</strong>
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {log.createdAt ? new Date(log.createdAt).toLocaleTimeString("pt-BR") : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                    {log.playgroundScore !== null && (
                      <div>
                        <span style={{ color: "#64748b" }}>Playground: </span>
                        <strong style={{ color: "#0f172a" }}>{log.playgroundScore} / 10</strong>
                      </div>
                    )}
                    {log.circuitoScore !== null && (
                      <div>
                        <span style={{ color: "#64748b" }}>Circuito: </span>
                        <strong style={{ color: "#0f172a" }}>{log.circuitoScore} / 10</strong>
                      </div>
                    )}
                    {log.teamScore != null && (
                      <div>
                        <span style={{ color: "#64748b" }}>Equipe: </span>
                        <strong style={{ color: "#0f172a" }}>{log.teamScore} / 5</strong>
                      </div>
                    )}
                    {log.spaceScore != null && (
                      <div>
                        <span style={{ color: "#64748b" }}>Espaço: </span>
                        <strong style={{ color: "#0f172a" }}>{log.spaceScore} / 5</strong>
                      </div>
                    )}
                  </div>

                  {log.feedback && (
                    <div style={{ fontSize: "13px", color: "#334155", fontStyle: "italic", background: "#ffffff", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                      "{log.feedback}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
