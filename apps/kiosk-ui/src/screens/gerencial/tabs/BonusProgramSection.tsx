import { useEffect, useState } from "react";
import { Button, Card, Input, HelpText } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Unit } from "../../../api/client.js";
import type { BonusProgramConfig, BonusProgramGoal, BonusProgramsByUnit } from "../../../lib/apuracaoBonificacao.js";
import { useToast } from "../../../state/ToastContext.js";

type GroupKey = "SEG_QUI" | "SEX" | "SAB" | "DOM";

const GROUPS: { key: GroupKey; label: string; weekdays: number[] }[] = [
  { key: "SEG_QUI", label: "Segunda a quinta", weekdays: [1, 2, 3, 4] },
  { key: "SEX", label: "Sexta", weekdays: [5] },
  { key: "SAB", label: "Sábado", weekdays: [6] },
  { key: "DOM", label: "Domingo", weekdays: [7] },
];

interface GroupForm {
  metaValor: string;
  superValor: string;
  metaBonusReais: string;
  superBonusReais: string;
}

interface UnitForm {
  groups: Record<GroupKey, GroupForm>;
  tetoMesReais: string;
  produtoPrecoCorteReais: string;
  produtoBonusBaixoReais: string;
  produtoBonusAltoReais: string;
  itensMesMeta: string;
  itensMesBonusReais: string;
  sessao1hPercentualMin: string;
  sessao1hBonusReais: string;
  locacaoExtraBonusReais: string;
}

const EMPTY_GROUP: GroupForm = { metaValor: "0", superValor: "0", metaBonusReais: "0.00", superBonusReais: "0.00" };
const EMPTY_FORM: UnitForm = {
  groups: { SEG_QUI: { ...EMPTY_GROUP }, SEX: { ...EMPTY_GROUP }, SAB: { ...EMPTY_GROUP }, DOM: { ...EMPTY_GROUP } },
  tetoMesReais: "0.00",
  produtoPrecoCorteReais: "0.00",
  produtoBonusBaixoReais: "0.00",
  produtoBonusAltoReais: "0.00",
  itensMesMeta: "0",
  itensMesBonusReais: "0.00",
  sessao1hPercentualMin: "0",
  sessao1hBonusReais: "0.00",
  locacaoExtraBonusReais: "0.00",
};

function reais(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFrom(reaisStr: string): number {
  return Math.round(Number(reaisStr || "0") * 100);
}

function formFromProgram(program: BonusProgramConfig | undefined, isCircuito: boolean): UnitForm {
  const groups = { ...EMPTY_FORM.groups };
  for (const g of GROUPS) {
    const goal = program?.goals.find((x) => x.weekday === g.weekdays[0]);
    groups[g.key] = goal
      ? {
          metaValor: isCircuito ? String(goal.metaValor) : reais(goal.metaValor),
          superValor: isCircuito ? String(goal.superValor) : reais(goal.superValor),
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
    itensMesMeta: String(program.itensMesMeta),
    itensMesBonusReais: reais(program.itensMesBonusCents),
    sessao1hPercentualMin: String(program.sessao1hPercentualMin),
    sessao1hBonusReais: reais(program.sessao1hBonusCents),
    locacaoExtraBonusReais: reais(program.locacaoExtraBonusCents),
  };
}

function goalsFromForm(form: UnitForm, isCircuito: boolean): BonusProgramGoal[] {
  return GROUPS.flatMap((g) => {
    const gf = form.groups[g.key];
    const metaValor = isCircuito ? Math.round(Number(gf.metaValor || "0")) : centsFrom(gf.metaValor);
    const superValor = isCircuito ? Math.round(Number(gf.superValor || "0")) : centsFrom(gf.superValor);
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
    itensMesMeta: Math.round(Number(form.itensMesMeta || "0")),
    itensMesBonusCents: centsFrom(form.itensMesBonusReais),
    sessao1hPercentualMin: Math.round(Number(form.sessao1hPercentualMin || "0")),
    sessao1hBonusCents: centsFrom(form.sessao1hBonusReais),
    locacaoExtraBonusCents: centsFrom(form.locacaoExtraBonusReais),
  };
}

/**
 * Configuração do programa de bonificação (meta/supermeta por dia da
 * semana + teto, produtos e bônus extras), por unidade — o que antes só
 * dava para mudar editando apuracaoBonificacao.ts/bonificacao.ts. Lido pelo
 * card "Bonificação de hoje" do Painel e pelo menu individual "Minha
 * Bonificação" de cada colaborador (apps/kiosk-ui/src/screens/MinhaBonificacaoScreen.tsx).
 * Uma unidade sem nenhuma configuração salva aqui simplesmente não gera
 * bônus — nunca um valor adivinhado.
 */
export function BonusProgramSection({ units }: { units: Unit[] }) {
  const toast = useToast();
  const [forms, setForms] = useState<Record<string, UnitForm>>({});
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);

  function load() {
    if (units.length === 0) return;
    Api.bonusProgramsByUnit(units.map((u) => u.id)).then((programs: BonusProgramsByUnit) => {
      const next: Record<string, UnitForm> = {};
      for (const u of units) {
        next[u.id] = formFromProgram(programs[u.id], u.kind === "QUIOSQUE");
      }
      setForms(next);
    });
  }
  useEffect(load, [units]);

  function updateGroup(unitId: string, group: GroupKey, patch: Partial<GroupForm>) {
    setForms((prev) => {
      const form = prev[unitId] ?? EMPTY_FORM;
      return { ...prev, [unitId]: { ...form, groups: { ...form.groups, [group]: { ...form.groups[group], ...patch } } } };
    });
  }

  function updateConfig(unitId: string, patch: Partial<UnitForm>) {
    setForms((prev) => ({ ...prev, [unitId]: { ...(prev[unitId] ?? EMPTY_FORM), ...patch } }));
  }

  async function save(unit: Unit) {
    const form = forms[unit.id];
    if (!form) return;
    const isCircuito = unit.kind === "QUIOSQUE";
    setBusyUnitId(unit.id);
    try {
      await Api.setBonusProgram(unit.id, goalsFromForm(form, isCircuito), configFromForm(form));
      toast.success(`Programa de bonificação de ${unit.name} salvo.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o programa de bonificação.");
    } finally {
      setBusyUnitId(null);
    }
  }

  return (
    <div>
      {units.map((unit) => {
        const form = forms[unit.id];
        if (!form) return null;
        const isCircuito = unit.kind === "QUIOSQUE";
        const unidadeValor = isCircuito ? "locações" : "R$";
        return (
          <Card key={unit.id} style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ margin: 0 }}>🎮 Programa de Bonificação — {unit.name}</h3>
            <HelpText>
              Meta é {isCircuito ? "o número de locações" : "o faturamento"} do dia do operador. Uma unidade sem nada
              salvo aqui não gera bônus — o menu "Minha Bonificação" de cada colaborador mostra R$0 até você configurar.
            </HelpText>

            <div style={{ overflowX: "auto" }}>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Meta ({unidadeValor})</th>
                    <th>Supermeta ({unidadeValor})</th>
                    <th>Bônus meta (R$)</th>
                    <th>Bônus supermeta (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map((g) => {
                    const gf = form.groups[g.key];
                    return (
                      <tr key={g.key}>
                        <td>{g.label}</td>
                        <td>
                          <Input type="number" value={gf.metaValor} onChange={(e) => updateGroup(unit.id, g.key, { metaValor: e.target.value })} />
                        </td>
                        <td>
                          <Input type="number" value={gf.superValor} onChange={(e) => updateGroup(unit.id, g.key, { superValor: e.target.value })} />
                        </td>
                        <td>
                          <Input type="number" value={gf.metaBonusReais} onChange={(e) => updateGroup(unit.id, g.key, { metaBonusReais: e.target.value })} />
                        </td>
                        <td>
                          <Input type="number" value={gf.superBonusReais} onChange={(e) => updateGroup(unit.id, g.key, { superBonusReais: e.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <Input
                label="Teto de bônus no mês (R$)"
                type="number"
                value={form.tetoMesReais}
                onChange={(e) => updateConfig(unit.id, { tetoMesReais: e.target.value })}
              />
              <Input
                label="Preço de corte do produto (R$)"
                type="number"
                value={form.produtoPrecoCorteReais}
                onChange={(e) => updateConfig(unit.id, { produtoPrecoCorteReais: e.target.value })}
              />
              <Input
                label="Bônus produto abaixo do corte (R$)"
                type="number"
                value={form.produtoBonusBaixoReais}
                onChange={(e) => updateConfig(unit.id, { produtoBonusBaixoReais: e.target.value })}
              />
              <Input
                label="Bônus produto a partir do corte (R$)"
                type="number"
                value={form.produtoBonusAltoReais}
                onChange={(e) => updateConfig(unit.id, { produtoBonusAltoReais: e.target.value })}
              />
              <Input
                label="Meta de itens vendidos no mês"
                type="number"
                value={form.itensMesMeta}
                onChange={(e) => updateConfig(unit.id, { itensMesMeta: e.target.value })}
              />
              <Input
                label="Bônus ao bater a meta de itens (R$)"
                type="number"
                value={form.itensMesBonusReais}
                onChange={(e) => updateConfig(unit.id, { itensMesBonusReais: e.target.value })}
              />
              {!isCircuito && (
                <>
                  <Input
                    label="% mín. de sessões 1h+ para bônus extra"
                    type="number"
                    value={form.sessao1hPercentualMin}
                    onChange={(e) => updateConfig(unit.id, { sessao1hPercentualMin: e.target.value })}
                  />
                  <Input
                    label="Bônus extra de sessão 1h+ (R$)"
                    type="number"
                    value={form.sessao1hBonusReais}
                    onChange={(e) => updateConfig(unit.id, { sessao1hBonusReais: e.target.value })}
                  />
                </>
              )}
              {isCircuito && (
                <Input
                  label="Bônus por locação acima da meta (R$)"
                  type="number"
                  value={form.locacaoExtraBonusReais}
                  onChange={(e) => updateConfig(unit.id, { locacaoExtraBonusReais: e.target.value })}
                />
              )}
            </div>

            <Button variant="primary" disabled={busyUnitId === unit.id} onClick={() => save(unit)} style={{ alignSelf: "flex-start" }}>
              Salvar programa de {unit.name}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
