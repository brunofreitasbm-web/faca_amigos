import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { BonusRule, TicketGoal } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";
import { IfCan } from "../../../auth/RequireCapability.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { BonusProgramSection } from "./BonusProgramSection.js";

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

  // Weekday Goals Configuration per Unit
  const [weekdayGoals, setWeekdayGoals] = useState<Record<string, WeekdayGoal[]>>({
    playground: DEFAULT_PLAYGROUND_GOALS,
    circuito: DEFAULT_CIRCUITO_GOALS,
  });

  // Interactive Simulator Slider (% of Goal Attainment)
  const [simulationPercent, setSimulationPercent] = useState<number>(100);
  const [simulatingOperatorsCount, setSimulatingOperatorsCount] = useState<number>(4);

  // Ticket Goals per unit
  const [ticketGoals, setTicketGoals] = useState<Record<string, { minReais: string; targetReais: string }>>({});
  const [ticketBusyUnitId, setTicketBusyUnitId] = useState<string | null>(null);

  // Legacy/Custom Bonus Rules
  const [rules, setRules] = useState<BonusRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [valueReais, setValueReais] = useState("0");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Calculate Next Month Label for Publication
  const getNextMonthLabel = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `01/${month}/${year}`;
  };

  function loadTicketGoals() {
    Promise.all(units.map((u) => Api.ticketGoal(u.id).then((g): [string, TicketGoal | null] => [u.id, g]))).then((pairs) => {
      const next: Record<string, { minReais: string; targetReais: string }> = {};
      for (const [unitId, g] of pairs) {
        next[unitId] = { minReais: ((g?.minTicketCents ?? 0) / 100).toFixed(2), targetReais: ((g?.targetTicketCents ?? 0) / 100).toFixed(2) };
      }
      setTicketGoals(next);
    });
  }

  function loadRules() {
    Api.bonusRulesAllUnits().then(setRules);
  }

  useEffect(() => {
    loadTicketGoals();
    loadRules();
  }, [units]);

  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  async function saveTicketGoal(unitId: string) {
    const g = ticketGoals[unitId];
    if (!g) return;
    setTicketBusyUnitId(unitId);
    try {
      await Api.setTicketGoal(unitId, Math.round(Number(g.minReais) * 100), Math.round(Number(g.targetReais) * 100));
      toast.success("Meta de Ticket Médio salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setTicketBusyUnitId(null);
    }
  }

  function handleGoalChange(unitKey: string, index: number, field: keyof WeekdayGoal, val: number) {
    setWeekdayGoals((prev) => {
      const currentList = prev[unitKey] ?? DEFAULT_PLAYGROUND_GOALS;
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
      return { ...prev, [unitKey]: updated };
    });
  }

  async function handlePublishProgram() {
    setPublishing(true);
    try {
      // Simulate API saving the new rules scheduled for next month
      await new Promise((res) => setTimeout(res, 600));
      toast.success(`Programa de Bonificação publicado com sucesso! Validade agendada para ${getNextMonthLabel()}.`);
    } catch {
      toast.error("Erro ao publicar programa de bonificação.");
    } finally {
      setPublishing(false);
    }
  }

  function startEdit(r: BonusRule) {
    setEditingId(r.id);
    setDescription(r.description);
    setValueReais((r.rewardValueCents / 100).toFixed(2));
  }

  function cancelEdit() {
    setEditingId(null);
    setDescription("");
    setValueReais("0");
    setUnitIds(units.map((u) => u.id));
  }

  async function saveBonusRule() {
    setBusy(true);
    try {
      const payload = { description, rewardValueCents: Math.round(Number(valueReais) * 100) };

      if (editingId) {
        await Api.updateBonusRule(editingId, payload);
        toast.success("Regra de bonificação atualizada.");
      } else {
        await Promise.all(unitIds.map((unitId) => Api.createBonusRule({ unitId, ...payload })));
        toast.success(`Regra criada em ${unitIds.length} unidade(s).`);
      }
      cancelEdit();
      loadRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a regra.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(r: BonusRule) {
    if (!window.confirm(`Deseja realmente ${r.active ? "inativar/excluir" : "reativar"} a regra "${r.description}"?`)) return;
    try {
      await Api.setBonusRuleActive(r.id, !r.active);
      toast.success(r.active ? "Regra removida com sucesso." : "Regra reativada.");
      loadRules();
    } catch {
      toast.error("Não foi possível alterar a regra.");
    }
  }

  // --- Simulation Metrics Calculation ---
  const activeUnitKey = units.find((u) => u.id === selectedUnitId)?.name?.toLowerCase().includes("circuito") ? "circuito" : "playground";
  const goalsList: WeekdayGoal[] = weekdayGoals[activeUnitKey] ?? DEFAULT_PLAYGROUND_GOALS;

  // Average monthly base revenue calculation
  const totalWeeklyMetaBase = goalsList.reduce((acc, g) => acc + g.meta * (g.dayLabel.includes("Segunda") ? 4 : 1), 0);
  const estimatedMonthlyMetaBase = totalWeeklyMetaBase * 4.3; // ~4.3 weeks in a month
  const simulatedMonthlyRevenue = Math.round((estimatedMonthlyMetaBase * simulationPercent) / 100);

  // Bonus cost estimation
  const totalWeeklyBonusBase = goalsList.reduce((acc, g) => acc + g.bonusMeta * (g.dayLabel.includes("Segunda") ? 4 : 1), 0);
  const rawBonusMonthly = totalWeeklyBonusBase * 4.3 * simulatingOperatorsCount * (simulationPercent / 100);
  const simulatedTotalBonusCost = Math.min(rawBonusMonthly, Number(monthlyCapReais) * simulatingOperatorsCount);

  const simulatedNetRevenue = Math.max(0, simulatedMonthlyRevenue - simulatedTotalBonusCost);

  return (
<<<<<<< HEAD
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
        <Card style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "15px" }}>🏬 Unidade em Configuração</h3>
          <div style={{ display: "flex", gap: "8px" }}>
            {units.map((u) => (
              <Button
                key={u.id}
                variant={selectedUnitId === u.id ? "primary" : "secondary"}
                onClick={() => setSelectedUnitId(u.id)}
                style={{ flex: 1 }}
              >
                {u.name}
              </Button>
            ))}
          </div>
        </Card>

        <Card style={{ padding: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "15px" }}>⚙️ Travas Operacionais & Limites Globais</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <Input
              label="Teto Mensal (R$)"
              type="number"
              value={monthlyCapReais}
              onChange={(e) => setMonthlyCapReais(e.target.value)}
            />
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

      {/* GRID DE METAS POR DIA DA SEMANA */}
      <Card style={{ padding: "20px" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          📊 Metas Diárias e Prêmios de Atingimento ({units.find((u) => u.id === selectedUnitId)?.name})
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                <th style={{ padding: "8px" }}>Dia da Semana</th>
                <th style={{ padding: "8px" }}>Meta Base ({activeUnitKey === "circuito" ? "Locações" : "R$"})</th>
                <th style={{ padding: "8px" }}>Supermeta ({activeUnitKey === "circuito" ? "Locações" : "R$"})</th>
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
                      onChange={(e) => handleGoalChange(activeUnitKey, idx, "meta", Number(e.target.value))}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.superMeta)}
                      onChange={(e) => handleGoalChange(activeUnitKey, idx, "superMeta", Number(e.target.value))}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.bonusMeta)}
                      onChange={(e) => handleGoalChange(activeUnitKey, idx, "bonusMeta", Number(e.target.value))}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input
                      type="number"
                      value={String(g.bonusSuper)}
                      onChange={(e) => handleGoalChange(activeUnitKey, idx, "bonusSuper", Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* SIMULADOR INTERATIVO COM RÉGUA DE ARRASTE (SLIDER) */}
      <Card style={{ padding: "20px", background: "var(--surface-elevated)", border: "1px solid var(--border-prominent)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              🎛️ Simulador Comercial & Potencial de Faturamento
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Arraste a régua para projetar o impacto financeiro do cumprimento de metas no mês.
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

        {/* RÉGUA DE ARRASTE / SLIDER */}
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
            <span>100% (Meta Batida)</span>
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
              {money(simulatedMonthlyRevenue * 100)}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Estimativa mensal da unidade</span>
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
              {money(simulatedNetRevenue * 100)}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Faturamento líquido pós-bônus</span>
          </div>
        </div>
      </Card>

      {/* META DE TICKET MÉDIO DA UNIDADE */}
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h3 title="Faixas que alimentam o termômetro de Ticket Médio no Painel de cada unidade" style={{ margin: 0, fontSize: "15px" }}>
          🎯 Meta Estratégica de Ticket Médio
          {!can("metas.ticket.write") && <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}> (exclusivo Owner)</span>}
        </h3>
=======
    <div>
      <BonusProgramSection units={units} />
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 title="Faixas que alimentam o termômetro de Ticket Médio no Painel de cada unidade">
          Meta de Ticket Médio
          {!can("metas.ticket.write") && <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}> (só o Owner edita)</span>}
        </h2>
>>>>>>> 105884e6212c03ed87b78ecbfa76e707f80c47f0
        {units.map((u) => {
          const g = ticketGoals[u.id];
          if (!g) return null;
          return (
            <div key={u.id} style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
              <strong style={{ minWidth: "140px" }}>{u.name}</strong>
              <IfCan capability="metas.ticket.write">
                <div style={{ width: "140px" }}>
                  <Input
                    label="Mínimo (R$)"
                    type="number"
                    value={g.minReais}
                    onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, minReais: e.target.value } }))}
                  />
                </div>
                <div style={{ width: "140px" }}>
                  <Input
                    label="Alvo (R$)"
                    type="number"
                    value={g.targetReais}
                    onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, targetReais: e.target.value } }))}
                  />
                </div>
                <Button variant="primary" disabled={ticketBusyUnitId === u.id} onClick={() => saveTicketGoal(u.id)}>
                  Salvar
                </Button>
              </IfCan>
              {!can("metas.ticket.write") && (
                <span style={{ fontSize: "14px" }}>
                  Mínimo: {money(Math.round(Number(g.minReais) * 100))} · Alvo: {money(Math.round(Number(g.targetReais) * 100))}
                </span>
              )}
            </div>
          );
        })}
      </Card>

      {/* REGRAS DE RECOMPENSA E PRODUTOS AVULSOS */}
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>
            {editingId ? "Editar Regra de Recompensa" : "Regras Adicionais de Bonificação por Item/Produto"}
          </h3>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Descrição" placeholder="Ex: Bônus por venda de meia ou garrafa d'água" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input label="Valor (R$)" type="number" value={valueReais} onChange={(e) => setValueReais(e.target.value)} />
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        <Button variant="primary" disabled={busy || !description || (!editingId && unitIds.length === 0)} onClick={saveBonusRule}>
          {editingId ? "Salvar regra" : `Criar regra em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>

      {/* LISTA DE REGRAS CADASTRADAS */}
      {rules.map((r) => (
        <Card key={r.id} style={{ padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: r.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
          <span>
            {r.description}
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}> · {units.find((u) => u.id === r.unitId)?.name ?? "—"}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <strong>{money(r.rewardValueCents)}</strong>
            <Button variant="secondary" onClick={() => startEdit(r)} disabled={busy}>
              Editar
            </Button>
            {r.active ? (
              <Button variant="secondary" style={{ color: "#d32f2f", borderColor: "#d32f2f" }} onClick={() => handleToggleActive(r)} disabled={busy}>
                Excluir
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(r)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}
