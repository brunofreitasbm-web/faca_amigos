import { useState } from "react";
import { DateInput, Select, Tabs, HelpText } from "@facaamigos/ui";
import { useAppState } from "../../../state/AppState.js";
import {
  computeDatesForPeriod,
  isoDate,
  VendasTab,
  PlanosVendidosTab,
  VisitasTab,
  CheckinsPorHoraTab,
  SessoesTab,
  FrotaHeatmapTab,
} from "../../RelatorioScreen.js";
import type { PeriodPreset } from "../../RelatorioScreen.js";

type Tab = "VENDAS" | "PLANOS" | "VISITAS" | "CHECKINS_HORA" | "SESSOES" | "FROTA";

/**
 * Mesma estrutura de abas do Relatório por unidade, só que com um filtro de
 * unidade no topo: "Todas as unidades" agrega as 3 (Api.reportXxx aceita
 * `unitId: null` para isso), ou escolha uma para ver só ela. Frota só faz
 * sentido com uma unidade específica selecionada — não há frota "agregada"
 * entre unidades, cada carrinho pertence só a uma.
 */
export function GerencialRelatorioTab() {
  const { units } = useAppState();
  const [tab, setTab] = useState<Tab>("VENDAS");
  const [unitFilter, setUnitFilter] = useState<string>("ALL");
  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));

  const { from, to } = computeDatesForPeriod(period, customFrom, customTo);
  const unitId = unitFilter === "ALL" ? null : unitFilter;
  const selectedUnit = units.find((u) => u.id === unitFilter);
  const isQuiosque = selectedUnit?.kind === "QUIOSQUE";

  const tabs: { value: Tab; label: string }[] = [
    { value: "VENDAS", label: "Vendas" },
    { value: "PLANOS", label: "Planos vendidos" },
    { value: "VISITAS", label: "Visitas" },
    { value: "CHECKINS_HORA", label: "Check-ins por hora" },
    { value: "SESSOES", label: "Sessões (auditoria)" },
    ...(isQuiosque ? ([{ value: "FROTA" as const, label: "Frota (mapa de calor)" }] as const) : []),
  ];

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px", padding: "16px", margin: "16px 0", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ width: "200px" }}>
          <Select label="Unidade" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            <option value="ALL">Todas as unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
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
      {unitId === null && (
        <HelpText style={{ margin: "12px 0" }}>Somando as {units.length} unidades. Escolha uma acima para ver só ela.</HelpText>
      )}

      <div role="tabpanel">
        {tab === "VENDAS" && <VendasTab unitId={unitId} from={from} to={to} />}
        {tab === "PLANOS" && <PlanosVendidosTab unitId={unitId} from={from} to={to} />}
        {tab === "VISITAS" && <VisitasTab unitId={unitId} from={from} to={to} />}
        {tab === "CHECKINS_HORA" && <CheckinsPorHoraTab unitId={unitId} from={from} to={to} />}
        {tab === "SESSOES" && <SessoesTab unitId={unitId} from={from} to={to} />}
        {tab === "FROTA" && isQuiosque && <FrotaHeatmapTab unitId={unitFilter} from={from} to={to} />}
      </div>
    </div>
  );
}
