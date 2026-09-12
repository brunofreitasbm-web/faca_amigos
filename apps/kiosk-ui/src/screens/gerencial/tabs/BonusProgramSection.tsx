import { useEffect, useState, useMemo } from "react";
import { Button, Card, HelpText } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Unit } from "../../../api/client.js";
import type { BonusProgramConfig, BonusProgramGoal, BonusProgramsByUnit } from "../../../lib/apuracaoBonificacao.js";
import { useToast } from "../../../state/ToastContext.js";
import { supabase } from "../../../lib/supabase/client.js";
import { money } from "../../../format.js";

type GroupKey = "SEG_QUI" | "SEX" | "SAB" | "DOM";

const GROUPS: { key: GroupKey; label: string; weekdays: number[]; pesoDias: number }[] = [
  { key: "SEG_QUI", label: "Segunda a quinta (16.5 dias/mês)", weekdays: [1, 2, 3, 4], pesoDias: 16.5 },
  { key: "SEX", label: "Sexta-feira (4.3 dias/mês)", weekdays: [5], pesoDias: 4.3 },
  { key: "SAB", label: "Sábado (4.3 dias/mês)", weekdays: [6], pesoDias: 4.3 },
  { key: "DOM", label: "Domingo (4.3 dias/mês)", weekdays: [7], pesoDias: 4.3 },
];

interface GroupForm {
  metaValor: number; // Em R$ para LOJA, em Unidades/Locações para QUIOSQUE
  superValor: number;
  metaBonusReais: number;
  superBonusReais: number;
}

interface UnitForm {
  groups: Record<GroupKey, GroupForm>;
  tetoMesReais: number;
  produtoPrecoCorteReais: number;
  produtoBonusBaixoReais: number;
  produtoBonusAltoReais: number;
  itensMesMeta: number;
  itensMesBonusReais: number;
  sessao1hPercentualMin: number;
  sessao1hBonusReais: number;
  locacaoExtraBonusReais: number;
}

const EMPTY_GROUP: GroupForm = { metaValor: 0, superValor: 0, metaBonusReais: 0, superBonusReais: 0 };
const EMPTY_FORM: UnitForm = {
  groups: { SEG_QUI: { ...EMPTY_GROUP }, SEX: { ...EMPTY_GROUP }, SAB: { ...EMPTY_GROUP }, DOM: { ...EMPTY_GROUP } },
  tetoMesReais: 200,
  produtoPrecoCorteReais: 15,
  produtoBonusBaixoReais: 0.5,
  produtoBonusAltoReais: 1.0,
  itensMesMeta: 10,
  itensMesBonusReais: 10,
  sessao1hPercentualMin: 30,
  sessao1hBonusReais: 5,
  locacaoExtraBonusReais: 2,
};

function reais(cents: number): number {
  return cents / 100;
}

function centsFrom(reaisNum: number): number {
  return Math.round(Number(reaisNum || 0) * 100);
}

function formFromProgram(program: BonusProgramConfig | undefined, isCircuito: boolean): UnitForm {
  const groups = { ...EMPTY_FORM.groups };
  for (const g of GROUPS) {
    const goal = program?.goals.find((x) => x.weekday === g.weekdays[0]);
    groups[g.key] = goal
      ? {
          metaValor: isCircuito ? goal.metaValor : reais(goal.metaValor),
          superValor: isCircuito ? goal.superValor : reais(goal.superValor),
          metaBonusReais: reais(goal.metaBonusCents),
          superBonusReais: reais(goal.superBonusCents),
        }
      : { ...EMPTY_GROUP };
  }
  if (!program) return { ...EMPTY_FORM, groups };
  return {
    groups,
    tetoMesReais: reais(program.tetoMesCents),
    produtoPrecoCorteReais: reais(program.produtoPrecoCorteCents),
    produtoBonusBaixoReais: reais(program.produtoBonusBaixoCents),
    produtoBonusAltoReais: reais(program.produtoBonusAltoCents),
    itensMesMeta: program.itensMesMeta,
    itensMesBonusReais: reais(program.itensMesBonusCents),
    sessao1hPercentualMin: program.sessao1hPercentualMin,
    sessao1hBonusReais: reais(program.sessao1hBonusCents),
    locacaoExtraBonusReais: reais(program.locacaoExtraBonusCents),
  };
}

function goalsFromForm(form: UnitForm, isCircuito: boolean): BonusProgramGoal[] {
  return GROUPS.flatMap((g) => {
    const gf = form.groups[g.key];
    const metaValor = isCircuito ? Math.round(gf.metaValor) : centsFrom(gf.metaValor);
    const superValor = isCircuito ? Math.round(gf.superValor) : centsFrom(gf.superValor);
    return g.weekdays.map((weekday) => ({
      weekday,
      metaValor,
      superValor,
      metaBonusCents: centsFrom(gf.metaBonusReais),
      superBonusCents: centsFrom(gf.superBonusReais),
    }));
  });
}

function configFromForm(form: UnitForm): Omit<BonusProgramConfig, "goals"> {
  return {
    tetoMesCents: centsFrom(form.tetoMesReais),
    produtoPrecoCorteCents: centsFrom(form.produtoPrecoCorteReais),
    produtoBonusBaixoCents: centsFrom(form.produtoBonusBaixoReais),
    produtoBonusAltoCents: centsFrom(form.produtoBonusAltoReais),
    itensMesMeta: Math.round(form.itensMesMeta || 0),
    itensMesBonusCents: centsFrom(form.itensMesBonusReais),
    sessao1hPercentualMin: Math.round(form.sessao1hPercentualMin || 0),
    sessao1hBonusCents: centsFrom(form.sessao1hBonusReais),
    locacaoExtraBonusCents: centsFrom(form.locacaoExtraBonusReais),
  };
}

interface HistoricalStats {
  dailyAvgRevenue: number;
  dailyAvgLocacoes: number;
  avgTicket: number;
  hasData: boolean;
}

export function BonusProgramSection({ units }: { units: Unit[] }) {
  const toast = useToast();
  const [forms, setForms] = useState<Record<string, UnitForm>>({});
  const [history, setHistory] = useState<Record<string, HistoricalStats>>({});
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);

  function loadData() {
    if (units.length === 0) return;
    Api.bonusProgramsByUnit(units.map((u) => u.id)).then((programs: BonusProgramsByUnit) => {
      const next: Record<string, UnitForm> = {};
      for (const u of units) {
        next[u.id] = formFromProgram(programs[u.id], u.kind === "QUIOSQUE");
      }
      setForms(next);
    });

    // Busca histórico dos últimos 60 dias para cálculo estatístico de metas em tempo real
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const startDate = sixtyDaysAgo.toISOString().split("T")[0];

    const unitIds = units.map((u) => u.id);
    Promise.all([
      supabase()
        .from("fa_kiosk_orders")
        .select("unit_id, total_cents, business_date, status")
        .in("unit_id", unitIds)
        .gte("business_date", startDate)
        .eq("status", "PAID"),
      supabase()
        .from("fa_kiosk_sessions")
        .select("unit_id, business_date")
        .in("unit_id", unitIds)
        .gte("business_date", startDate),
    ]).then(([ordersRes, sessionsRes]) => {
      const orders = ordersRes.data || [];
      const sessions = sessionsRes.data || [];
      const statsMap: Record<string, HistoricalStats> = {};

      for (const u of units) {
        const uOrders = orders.filter((o) => o.unit_id === u.id);
        const uSessions = sessions.filter((s) => s.unit_id === u.id);

        const uniqueDays = new Set([
          ...uOrders.map((o) => o.business_date),
          ...uSessions.map((s) => s.business_date),
        ]).size || 1;

        const totalRevenueCents = uOrders.reduce((acc, curr) => acc + (curr.total_cents || 0), 0);
        const totalSessions = uSessions.length;

        const dailyAvgRevenue = (totalRevenueCents / 100) / uniqueDays;
        const dailyAvgLocacoes = totalSessions / uniqueDays;
        const avgTicket = totalSessions > 0 ? (totalRevenueCents / 100) / totalSessions : 25;

        statsMap[u.id] = {
          dailyAvgRevenue: dailyAvgRevenue || (u.kind === "QUIOSQUE" ? 800 : 1500),
          dailyAvgLocacoes: dailyAvgLocacoes || 30,
          avgTicket: avgTicket || 25,
          hasData: uOrders.length > 0 || uSessions.length > 0,
        };
      }
      setHistory(statsMap);
    }).catch((err) => {
      console.warn("Erro ao buscar histórico de vendas para balizamento de metas:", err);
    });
  }

  useEffect(loadData, [units]);

  function updateGroup(unitId: string, group: GroupKey, patch: Partial<GroupForm>) {
    setForms((prev) => {
      const form = prev[unitId] ?? EMPTY_FORM;
      const currentGroup = form.groups[group];
      const updatedGroup = { ...currentGroup, ...patch };

      // Regra de Vínculo Automático: Supermeta deve ser sempre >= Meta
      if (patch.metaValor !== undefined && updatedGroup.superValor < patch.metaValor) {
        updatedGroup.superValor = Math.round(patch.metaValor * 1.25);
      }
      if (patch.superValor !== undefined && updatedGroup.superValor < updatedGroup.metaValor) {
        updatedGroup.metaValor = updatedGroup.superValor;
      }
      // Bônus Supermeta >= Bônus Meta
      if (patch.metaBonusReais !== undefined && updatedGroup.superBonusReais < patch.metaBonusReais) {
        updatedGroup.superBonusReais = Math.round(patch.metaBonusReais * 1.5);
      }

      return {
        ...prev,
        [unitId]: {
          ...form,
          groups: { ...form.groups, [group]: updatedGroup },
        },
      };
    });
  }

  function updateConfig(unitId: string, patch: Partial<UnitForm>) {
    setForms((prev) => {
      const current = prev[unitId] ?? EMPTY_FORM;
      const updated = { ...current, ...patch };

      // Se o Teto Mensal (R$) mudou, recalcula automaticamente os prêmios diários de Meta e Supermeta!
      if (patch.tetoMesReais !== undefined && patch.tetoMesReais > 0 && current.tetoMesReais > 0) {
        const ratio = patch.tetoMesReais / current.tetoMesReais;
        const newGroups = { ...updated.groups };
        for (const g of GROUPS) {
          const group = newGroups[g.key];
          newGroups[g.key] = {
            ...group,
            metaBonusReais: Math.max(1, Math.round(group.metaBonusReais * ratio)),
            superBonusReais: Math.max(1, Math.round(group.superBonusReais * ratio)),
          };
        }
        updated.groups = newGroups;
      }

      return { ...prev, [unitId]: updated };
    });
  }

  function applyPreset(unitId: string, percentMultiplier: number) {
    setForms((prev) => {
      const form = prev[unitId];
      if (!form) return prev;
      const newGroups = { ...form.groups };
      for (const g of GROUPS) {
        const curr = newGroups[g.key];
        const newMeta = Math.round(curr.metaValor * (1 + percentMultiplier));
        newGroups[g.key] = {
          ...curr,
          metaValor: newMeta,
          superValor: Math.round(newMeta * 1.25),
        };
      }
      return { ...prev, [unitId]: { ...form, groups: newGroups } };
    });
  }

  async function save(unit: Unit) {
    const form = forms[unit.id];
    if (!form) return;
    const isCircuito = unit.kind === "QUIOSQUE";
    setBusyUnitId(unit.id);
    try {
      await Api.setBonusProgram(unit.id, goalsFromForm(form, isCircuito), configFromForm(form));
      toast.success(`Programa de bonificação de ${unit.name} salvo com sucesso!`);
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o programa de bonificação.");
    } finally {
      setBusyUnitId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {units.map((unit) => {
        const form = forms[unit.id];
        if (!form) return null;
        const isCircuito = unit.kind === "QUIOSQUE";
        const unitStats = history[unit.id] ?? { dailyAvgRevenue: 1200, dailyAvgLocacoes: 40, avgTicket: 25, hasData: false };

        // 1. Cálculo da Meta Diária Ponderada no Mês (29.4 dias operacionais em média)
        const totalMetaPonderadaMes = GROUPS.reduce((acc, g) => {
          const val = form.groups[g.key].metaValor;
          return acc + val * g.pesoDias;
        }, 0);

        const totalSupermetaPonderadaMes = GROUPS.reduce((acc, g) => {
          const val = form.groups[g.key].superValor;
          return acc + val * g.pesoDias;
        }, 0);

        const dailyMetaPonderadaAvg = totalMetaPonderadaMes / 29.4;

        // 2. Faturamento Esperado no Mês (100% Meta e Supermeta - Locações * R$ 48 TM para Quiosque)
        const CIRCUITO_TM_REAIS = 48;
        const faturamentoEsperadoMeta = isCircuito
          ? totalMetaPonderadaMes * CIRCUITO_TM_REAIS
          : totalMetaPonderadaMes;

        const faturamentoEsperadoSuper = isCircuito
          ? totalSupermetaPonderadaMes * CIRCUITO_TM_REAIS
          : totalSupermetaPonderadaMes;

        // Estudo de Viabilidade da Meta em Relação ao Histórico
        const baselineComparacao = isCircuito ? unitStats.dailyAvgLocacoes : unitStats.dailyAvgRevenue;
        const ratioHistorico = baselineComparacao > 0 ? dailyMetaPonderadaAvg / baselineComparacao : 1;

        let statusMeta: { title: string; color: string; bg: string; icon: string; desc: string };
        if (ratioHistorico < 0.95) {
          statusMeta = {
            title: "FRACA",
            color: "#EF4444",
            bg: "rgba(239, 68, 68, 0.12)",
            icon: "🔴",
            desc: "Meta estipulada está abaixo da média histórica da unidade. Baixo estímulo para a equipe alavancar vendas.",
          };
        } else if (ratioHistorico <= 1.25) {
          statusMeta = {
            title: "REALISTA",
            color: "#10B981",
            bg: "rgba(16, 185, 129, 0.12)",
            icon: "🟢",
            desc: "Meta equilibrada e pé no chão, perfeitamente alinhada ao crescimento sustentável da unidade.",
          };
        } else {
          statusMeta = {
            title: "AGRESSIVA",
            color: "#8B5CF6",
            bg: "rgba(139, 92, 246, 0.12)",
            icon: "⚡",
            desc: "Meta desafiadora e de alta performance! Foco em acelerar o ticket médio e volume de locações.",
          };
        }

        // Estimativa do Custo Máximo do Bônus em Folha caso 100% da Meta Seja Batida
        const maxOperadoresEstimados = 2;
        const custoBonusMetaMes = GROUPS.reduce((acc, g) => acc + form.groups[g.key].metaBonusReais * g.pesoDias, 0) * maxOperadoresEstimados;

        const maxRangeSlider = isCircuito ? Math.max(150, Math.round(unitStats.dailyAvgLocacoes * 2.5)) : Math.max(5000, Math.round(unitStats.dailyAvgRevenue * 2.5));

        return (
          <Card
            key={unit.id}
            style={{
              padding: "24px",
              borderRadius: "16px",
              background: "var(--surface-elevated, #ffffff)",
              border: "1px solid var(--border-subtle, #e2e8f0)",
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            {/* Header da Unidade */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "20px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                  🎮 Programa de Bonificação — {unit.name}
                  <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "12px", background: "var(--surface-sunken)", color: "var(--text-secondary)" }}>
                    {isCircuito ? "Unidade Quiosque (Metas em Locações)" : "Unidade Loja (Metas em Faturamento R$)"}
                  </span>
                </h3>
                <HelpText style={{ marginTop: "4px" }}>
                  Ajuste as metas interativamente deslizando a barra. Os valores vinculados e as estimativas de faturamento se recalculam em tempo real.
                </HelpText>
              </div>

              {/* Presets Rápidos */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)" }}>Ajuste Rápido:</span>
                <button
                  type="button"
                  onClick={() => applyPreset(unit.id, 0.05)}
                  style={{ padding: "6px 12px", borderRadius: "20px", border: "1px solid #10B981", background: "rgba(16, 185, 129, 0.08)", color: "#059669", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
                >
                  +5% Crescimento
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(unit.id, 0.15)}
                  style={{ padding: "6px 12px", borderRadius: "20px", border: "1px solid #3B82F6", background: "rgba(59, 130, 246, 0.08)", color: "#2563EB", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
                >
                  +15% Aceleração
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(unit.id, 0.30)}
                  style={{ padding: "6px 12px", borderRadius: "20px", border: "1px solid #8B5CF6", background: "rgba(139, 92, 246, 0.08)", color: "#6D28D9", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
                >
                  +30% Super Meta
                </button>
              </div>
            </div>

            {/* DASHBOARD PRINCIPAL: VISIBILIDADE DE METAS & FATURAMENTO ESPERADO */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "16px",
              }}
            >
              {/* CARD DE FATURAMENTO ESPERADO (100% META) */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "14px",
                  background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
                  color: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 8px 20px rgba(49, 46, 129, 0.25)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: "-10px", right: "-10px", fontSize: "70px", opacity: 0.1, userSelect: "none" }}>
                  💰
                </div>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", color: "#a5b4fc" }}>
                    🎯 FATURAMENTO MENSAL ESPERADO (100% META)
                  </span>
                  <div style={{ fontSize: "32px", fontWeight: "900", margin: "8px 0 4px", color: "#ffffff", fontFamily: "var(--font-display)" }}>
                    {money(centsFrom(faturamentoEsperadoMeta))}
                  </div>
                  <div style={{ fontSize: "13px", color: "#c7d2fe" }}>
                    Com Supermeta (125%): <strong style={{ color: "#38bdf8" }}>{money(centsFrom(faturamentoEsperadoSuper))}</strong>
                  </div>
                </div>

                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(255, 255, 255, 0.15)", display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span>Est. Custo Bônus Equipe:</span>
                  <strong style={{ color: "#fef08a" }}>~{money(centsFrom(custoBonusMetaMes))} /mês</strong>
                </div>
              </div>

              {/* BADGE DA VIABILIDADE E HISTÓRICO */}
              <div
                style={{
                  padding: "20px",
                  borderRadius: "14px",
                  background: statusMeta.bg,
                  border: `2px solid ${statusMeta.color}`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "var(--text-secondary)" }}>
                      📊 ANÁLISE DE HISTÓRICO & VIABILIDADE
                    </span>
                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: "20px",
                        background: statusMeta.color,
                        color: "#ffffff",
                        fontWeight: "800",
                        fontSize: "13px",
                        letterSpacing: "0.5px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>{statusMeta.icon}</span> METAS {statusMeta.title}
                    </span>
                  </div>

                  <p style={{ fontSize: "13px", color: "var(--text-primary)", margin: "12px 0 8px", lineHeight: "1.4" }}>
                    {statusMeta.desc}
                  </p>
                </div>

                <div style={{ fontSize: "12px", background: "rgba(255, 255, 255, 0.6)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(0,0,0,0.05)" }}>
                  <div>
                    Média Histórica da Unidade:{" "}
                    <strong>
                      {unitStats.hasData
                        ? isCircuito
                          ? `${Math.round(unitStats.dailyAvgLocacoes)} locações/dia`
                          : `${money(centsFrom(unitStats.dailyAvgRevenue))}/dia`
                        : "Sem dados suficientes (estimado)"}
                    </strong>
                  </div>
                  <div style={{ marginTop: "2px", color: "var(--text-secondary)" }}>
                    Meta Ponderada Definida:{" "}
                    <strong style={{ color: statusMeta.color }}>
                      {isCircuito
                        ? `${Math.round(dailyMetaPonderadaAvg)} locações/dia`
                        : `${money(centsFrom(dailyMetaPonderadaAvg))}/dia`}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* SEÇÃO DE SLIDERS POR DIA DA SEMANA */}
            <div>
              <h4 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                📅 Escalas de Metas por Período da Semana
              </h4>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                {GROUPS.map((g) => {
                  const gf = form.groups[g.key];
                  return (
                    <div
                      key={g.key}
                      style={{
                        padding: "16px",
                        borderRadius: "12px",
                        background: "var(--surface-sunken, #f8fafc)",
                        border: "1px solid var(--border-subtle, #e2e8f0)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "700", fontSize: "14px" }}>{g.label}</span>
                        <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "10px", background: "var(--surface-elevated)", color: "var(--text-secondary)" }}>
                          {g.pesoDias} dias/mês
                        </span>
                      </div>

                      {/* SLIDER META BASE */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                          <span>🎯 Meta ({isCircuito ? "Locações" : "R$"})</span>
                          <strong style={{ color: "#2563EB", fontSize: "14px" }}>
                            {isCircuito ? `${gf.metaValor} locações` : money(centsFrom(gf.metaValor))}
                          </strong>
                        </div>
                        <input
                          type="range"
                          min={isCircuito ? "5" : "300"}
                          max={String(maxRangeSlider)}
                          step={isCircuito ? "1" : "50"}
                          value={gf.metaValor}
                          onChange={(e) => updateGroup(unit.id, g.key, { metaValor: Number(e.target.value) })}
                          style={{ width: "100%", accentColor: "#2563EB", cursor: "pointer" }}
                        />
                      </div>

                      {/* SLIDER SUPERMETA */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                          <span>⚡ Supermeta ({isCircuito ? "Locações" : "R$"})</span>
                          <strong style={{ color: "#6D28D9", fontSize: "14px" }}>
                            {isCircuito ? `${gf.superValor} locações` : money(centsFrom(gf.superValor))}
                          </strong>
                        </div>
                        <input
                          type="range"
                          min={isCircuito ? "5" : "300"}
                          max={String(Math.round(maxRangeSlider * 1.4))}
                          step={isCircuito ? "1" : "50"}
                          value={gf.superValor}
                          onChange={(e) => updateGroup(unit.id, g.key, { superValor: Number(e.target.value) })}
                          style={{ width: "100%", accentColor: "#6D28D9", cursor: "pointer" }}
                        />
                      </div>

                      {/* SLIDERS DE BÔNUS EM REAIS */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", paddingTop: "8px", borderTop: "1px dashed var(--border-subtle)" }}>
                        <div>
                          <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>
                            Bônus Meta (R$/dia)
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            step="1"
                            value={gf.metaBonusReais}
                            onChange={(e) => updateGroup(unit.id, g.key, { metaBonusReais: Number(e.target.value) })}
                            style={{ width: "100%", accentColor: "#059669" }}
                          />
                          <div style={{ fontSize: "12px", fontWeight: "700", color: "#059669" }}>
                            {money(centsFrom(gf.metaBonusReais))}
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>
                            Bônus Supermeta (R$/dia)
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={gf.superBonusReais}
                            onChange={(e) => updateGroup(unit.id, g.key, { superBonusReais: Number(e.target.value) })}
                            style={{ width: "100%", accentColor: "#7C3AED" }}
                          />
                          <div style={{ fontSize: "12px", fontWeight: "700", color: "#7C3AED" }}>
                            {money(centsFrom(gf.superBonusReais))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SEÇÃO DE REGRAS EXTRAS E TETOS */}
            <div>
              <h4 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700" }}>
                🎁 Bônus Extras, Produtos e Travas de Controle
              </h4>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                {/* Teto de Bônus */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Teto Máximo Mensal (R$)</span>
                    <strong style={{ color: "#D97706" }}>{money(centsFrom(form.tetoMesReais))}</strong>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="500"
                    step="10"
                    value={form.tetoMesReais}
                    onChange={(e) => updateConfig(unit.id, { tetoMesReais: Number(e.target.value) })}
                    style={{ width: "100%", accentColor: "#D97706", marginTop: "6px" }}
                  />
                </div>

                {/* Preço de Corte do Produto */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Preço Corte Produto (R$)</span>
                    <strong>{money(centsFrom(form.produtoPrecoCorteReais))}</strong>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="1"
                    value={form.produtoPrecoCorteReais}
                    onChange={(e) => updateConfig(unit.id, { produtoPrecoCorteReais: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </div>

                {/* Bônus Produto Abaixo */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Bônus Prod. Abaixo Corte</span>
                    <strong>{money(centsFrom(form.produtoBonusBaixoReais))}</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.10"
                    value={form.produtoBonusBaixoReais}
                    onChange={(e) => updateConfig(unit.id, { produtoBonusBaixoReais: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </div>

                {/* Bônus Produto Acima */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Bônus Prod. Acima Corte</span>
                    <strong>{money(centsFrom(form.produtoBonusAltoReais))}</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.50"
                    value={form.produtoBonusAltoReais}
                    onChange={(e) => updateConfig(unit.id, { produtoBonusAltoReais: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </div>

                {/* Meta Itens Mês */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Meta Itens Venda Mês</span>
                    <strong>{form.itensMesMeta} un.</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={form.itensMesMeta}
                    onChange={(e) => updateConfig(unit.id, { itensMesMeta: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </div>

                {/* Bônus Meta Itens Mês */}
                <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-sunken)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Bônus Meta Itens (R$)</span>
                    <strong>{money(centsFrom(form.itensMesBonusReais))}</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={form.itensMesBonusReais}
                    onChange={(e) => updateConfig(unit.id, { itensMesBonusReais: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </div>
              </div>
            </div>

            {/* BOTÃO FINAL DE SALVAR */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingTop: "12px", borderTop: "1px solid var(--border-subtle)" }}>
              <Button
                variant="primary"
                disabled={busyUnitId === unit.id}
                onClick={() => save(unit)}
                style={{ padding: "12px 28px", fontSize: "15px", fontWeight: "700", borderRadius: "10px", cursor: "pointer" }}
              >
                {busyUnitId === unit.id ? "Salvando..." : `💾 Salvar Configurações de ${unit.name}`}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
