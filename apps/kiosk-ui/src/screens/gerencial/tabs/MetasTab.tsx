import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { BonusRule } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

/**
 * Regras de bonificação apenas — a meta diária de faturamento e o horário
 * de fechamento (também na aba "Meta" da Configurações por unidade) são
 * ajustes operacionais de cada terminal, não uma configuração macro, e por
 * isso ficaram de fora do Gerencial (ver plano).
 */
export function MetasTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [rules, setRules] = useState<BonusRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [valueReais, setValueReais] = useState("0");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.bonusRulesAllUnits().then(setRules);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

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

  async function save() {
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
      load();
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
      load();
    } catch {
      toast.error("Não foi possível alterar a regra.");
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 title="Recompensas para o colaborador quando a meta diária é batida">
            {editingId ? "Editar Regra de Bonificação" : "Regras de Bonificação"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Descrição" placeholder="Ex: Bônus para o turno ao bater a meta" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input label="Valor (R$)" type="number" value={valueReais} onChange={(e) => setValueReais(e.target.value)} />
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        <Button variant="primary" disabled={busy || !description || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar regra" : `Criar regra em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>
      {rules.map((r) => (
        <Card key={r.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: r.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
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
