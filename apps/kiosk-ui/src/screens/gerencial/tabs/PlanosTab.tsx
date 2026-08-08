import { useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Plan, Unit } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

const PLAN_COLOR_OPTIONS = ["#2ECFB5", "#F0196B", "#FFE234", "#FF7A00", "#A020EE", "#1A3F35"];
const COLOR_NAMES: Record<string, string> = {
  "#2ECFB5": "Teal",
  "#F0196B": "Rosa",
  "#FFE234": "Amarelo",
  "#FF7A00": "Laranja",
  "#A020EE": "Roxo",
  "#1A3F35": "Verde-escuro",
};

function activityForUnit(unit: Unit): "PLAYGROUND" | "CARRINHO" {
  return unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
}

export function PlanosTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [valueReais, setValueReais] = useState("0");
  const [durationValue, setDurationValue] = useState("15");
  const [durationUnit, setDurationUnit] = useState<"MINUTO" | "HORA">("MINUTO");
  const [overageReais, setOverageReais] = useState("1");
  const [color, setColor] = useState(PLAN_COLOR_OPTIONS[0]!);
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.plansAllUnits().then(setPlans);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  function startEdit(p: Plan) {
    setEditingId(p.id);
    setName(p.name);
    setValueReais((p.valueCents / 100).toFixed(2));
    setDurationValue(String(p.durationValue));
    setDurationUnit(p.durationUnit);
    setOverageReais((p.overageCentsPerMinute / 100).toFixed(2));
    setColor(p.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setValueReais("0");
    setDurationValue("15");
    setDurationUnit("MINUTO");
    setOverageReais("1");
    setColor(PLAN_COLOR_OPTIONS[0]!);
    setUnitIds(units.map((u) => u.id));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name,
        valueCents: Math.round(Number(valueReais) * 100),
        durationValue: Number(durationValue),
        durationUnit,
        overageCentsPerMinute: Math.round(Number(overageReais) * 100),
        color,
      };

      if (editingId) {
        await Api.updatePlan(editingId, payload);
        toast.success("Plano atualizado.");
      } else {
        await Promise.all(
          unitIds.map((unitId) => {
            const unit = units.find((u) => u.id === unitId)!;
            return Api.createPlan({ unitId, activity: activityForUnit(unit), ...payload });
          }),
        );
        toast.success(`Plano criado em ${unitIds.length} unidade(s).`);
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o plano.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(p: Plan) {
    if (!window.confirm(`Deseja realmente ${p.active ? "inativar/excluir" : "reativar"} o plano "${p.name}"?`)) return;
    setBusy(true);
    try {
      await Api.setPlanActive(p.id, !p.active);
      toast.success(p.active ? "Plano removido com sucesso." : "Plano reativado.");
      load();
    } catch {
      toast.error("Erro ao alterar o plano.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar plano" : "Novo plano"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Valor (R$)" type="number" value={valueReais} onChange={(e) => setValueReais(e.target.value)} />
        <div style={{ display: "flex", gap: "8px" }}>
          <Input label="Duração" type="number" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
          <Select label="Unidade de tempo" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as "MINUTO" | "HORA")}>
            <option value="MINUTO">minuto(s)</option>
            <option value="HORA">hora(s)</option>
          </Select>
        </div>
        <Input
          label="Excedente por minuto (R$)"
          type="number"
          value={overageReais}
          onChange={(e) => setOverageReais(e.target.value)}
        />
        <div>
          <label>Cor no Painel</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {PLAN_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${COLOR_NAMES[c] ?? c}`}
                aria-pressed={color === c}
                title={COLOR_NAMES[c] ?? c}
                style={{ width: "28px", height: "28px", borderRadius: "50%", background: c, border: color === c ? "3px solid var(--color-dark)" : "1px solid var(--border-subtle)" }}
              />
            ))}
          </div>
        </div>
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        <Button variant="primary" disabled={busy || !name || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar plano" : `Criar plano em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>

      {plans.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: p.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block" }} />
            {p.name} — {p.durationValue} {p.durationUnit.toLowerCase()}
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              · {units.find((u) => u.id === p.unitId)?.name ?? "—"}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>
              {money(p.valueCents)} + {money(p.overageCentsPerMinute)}/min excedente
            </span>
            <Button variant="secondary" onClick={() => startEdit(p)} disabled={busy}>
              Editar
            </Button>
            {p.active ? (
              <Button variant="secondary" style={{ color: "#d32f2f", borderColor: "#d32f2f" }} onClick={() => handleToggleActive(p)} disabled={busy}>
                Excluir
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(p)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}
