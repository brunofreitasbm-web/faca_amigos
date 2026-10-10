import { useEffect, useState } from "react";
import { Button, Input, Select } from "@facaamigos/ui";
import { Card, FORM_GRID, FULL_ROW } from "../GCard.js";
import { Api } from "../../../api/client.js";
import type { LoyaltyRule, Unit } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

function activityForUnit(unit: Unit): "PLAYGROUND" | "CARRINHO" {
  return unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
}

export function FidelidadeTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [triggerVisits, setTriggerVisits] = useState("10");
  const [rewardKind, setRewardKind] = useState<LoyaltyRule["rewardKind"]>("ENTRADA_GRATIS");
  const [rewardValue, setRewardValue] = useState("1");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.loyaltyRulesAllUnits().then(setRules);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  async function create() {
    setBusy(true);
    try {
      await Promise.all(
        unitIds.map((unitId) => {
          const unit = units.find((u) => u.id === unitId)!;
          return Api.createLoyaltyRule({
            unitId,
            activity: activityForUnit(unit),
            triggerVisits: Number(triggerVisits),
            rewardKind,
            rewardValue: Number(rewardValue),
          });
        }),
      );
      load();
      toast.success(`Regra de fidelidade criada em ${unitIds.length} unidade(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar a regra de fidelidade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ marginBottom: "12px" }} bodyStyle={FORM_GRID}>
        <h2 style={{ ...FULL_ROW, fontFamily: "var(--font-display)", fontSize: "16px", margin: 0 }}>Nova regra</h2>
        <Input label="A cada X visitas" type="number" value={triggerVisits} onChange={(e) => setTriggerVisits(e.target.value)} />
        <Select label="Recompensa" value={rewardKind} onChange={(e) => setRewardKind(e.target.value as LoyaltyRule["rewardKind"])}>
          <option value="ENTRADA_GRATIS">Entrada grátis</option>
          <option value="DESCONTO_PCT">Desconto %</option>
          <option value="MINUTOS_EXTRA">Minutos extras</option>
        </Select>
        <Input label="Valor" type="number" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} />
        <div style={FULL_ROW}><UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} /></div>
        <Button variant="primary" style={{ ...FULL_ROW, justifySelf: "start" }} disabled={busy || unitIds.length === 0} onClick={create}>
          Criar regra em {unitIds.length} unidade(s)
        </Button>
      </Card>
      {rules.map((r) => (
        <Card key={r.id} style={{ padding: "12px", marginBottom: "8px" }}>
          A cada {r.triggerVisits} visitas ({r.activity}) → {r.rewardKind} ({r.rewardValue})
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}> · {units.find((u) => u.id === r.unitId)?.name ?? "—"}</span>
        </Card>
      ))}
    </div>
  );
}
