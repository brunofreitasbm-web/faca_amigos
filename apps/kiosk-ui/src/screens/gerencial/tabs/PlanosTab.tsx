import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Plan, Unit } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { useConfirm } from "../../../state/ConfirmContext.js";
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
  const confirm = useConfirm();
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const [statusFilter, setStatusFilter] = useState<"ATIVOS" | "INATIVOS">("ATIVOS");
  const [unitFilter, setUnitFilter] = useState<string>("ALL");

  const nameError = name.trim().length < 3 ? "Informe ao menos 3 caracteres." : undefined;
  const valueError = !(Number(valueReais) > 0) ? "Informe um valor maior que R$ 0,00." : undefined;
  const durationError =
    !Number.isInteger(Number(durationValue)) || Number(durationValue) <= 0
      ? "Informe um número inteiro maior que 0."
      : undefined;
  const overageError = !(Number(overageReais) >= 0) ? "O excedente não pode ser negativo." : undefined;
  const unitsError = !editingId && unitIds.length === 0 ? "Selecione ao menos uma unidade." : undefined;
  const isValid = !nameError && !valueError && !durationError && !overageError && !unitsError;

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
    setTouched({});
  }

  async function save() {
    if (!isValid) return;
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
    const unitName = units.find((u) => u.id === p.unitId)?.name ?? "—";
    if (p.active) {
      const ok = await confirm({
        title: `Excluir plano ${p.name}?`,
        message: `Esta ação removerá o plano "${p.name}" da unidade ${unitName} e não poderá ser desfeita.`,
        confirmLabel: "Sim, excluir plano",
        cancelLabel: "Cancelar",
        variant: "danger",
      });
      if (!ok) return;
    }
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

  const visiblePlans = useMemo(
    () =>
      plans.filter(
        (p) =>
          (statusFilter === "ATIVOS" ? p.active : !p.active) &&
          (unitFilter === "ALL" || p.unitId === unitFilter),
      ),
    [plans, statusFilter, unitFilter],
  );

  const plansByUnit = useMemo(() => {
    const groups: { unit: Unit; items: Plan[] }[] = [];
    for (const unit of units) {
      const items = visiblePlans.filter((p) => p.unitId === unit.id);
      if (items.length > 0) groups.push({ unit, items });
    }
    return groups;
  }, [visiblePlans, units]);

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
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => markTouched("name")}
          error={touched.name ? nameError : undefined}
        />
        <Input
          label="Valor (R$)"
          type="number"
          min="0.01"
          step="0.01"
          value={valueReais}
          onChange={(e) => setValueReais(e.target.value)}
          onBlur={() => markTouched("value")}
          error={touched.value ? valueError : undefined}
        />
        <div style={{ display: "flex", gap: "8px" }}>
          <Input
            label="Duração"
            type="number"
            min="1"
            step="1"
            value={durationValue}
            onChange={(e) => setDurationValue(e.target.value)}
            onBlur={() => markTouched("duration")}
            error={touched.duration ? durationError : undefined}
          />
          <Select label="Unidade de tempo" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as "MINUTO" | "HORA")}>
            <option value="MINUTO">minuto(s)</option>
            <option value="HORA">hora(s)</option>
          </Select>
        </div>
        <Input
          label="Excedente por minuto (R$)"
          type="number"
          min="0"
          step="0.01"
          value={overageReais}
          onChange={(e) => setOverageReais(e.target.value)}
          onBlur={() => markTouched("overage")}
          error={touched.overage ? overageError : undefined}
        />
        <div>
          <label id="plan-color-label">Cor no Painel</label>
          <div role="radiogroup" aria-labelledby="plan-color-label" style={{ display: "flex", gap: "4px" }}>
            {PLAN_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                onClick={() => setColor(c)}
                aria-label={`Cor ${COLOR_NAMES[c] ?? c}`}
                aria-checked={color === c}
                title={COLOR_NAMES[c] ?? c}
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: c,
                  border: color === c ? "3px solid var(--color-dark)" : "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "bold",
                  textShadow: "0 0 2px rgba(0,0,0,0.85)",
                }}
              >
                {color === c ? "✓" : ""}
              </button>
            ))}
          </div>
        </div>
        {!editingId && (
          <UnitCheckboxGroup units={units} selected={unitIds} onChange={(next) => { setUnitIds(next); markTouched("units"); }} />
        )}
        {touched.units && unitsError && (
          <span style={{ fontSize: "12px", color: "var(--color-error-text)", fontWeight: "var(--weight-medium)" as unknown as number }}>
            {unitsError}
          </span>
        )}
        <Button variant="primary" disabled={busy || !isValid} loading={busy} onClick={save}>
          {busy
            ? "Criando planos nas unidades…"
            : editingId
              ? "Salvar plano"
              : `Criar plano em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>

      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", margin: "16px 0 8px" }}>
        <Select
          label="Unidade"
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          style={{ minWidth: "180px" }}
        >
          <option value="ALL">Todas as unidades</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <div role="radiogroup" aria-label="Situação do plano" style={{ display: "flex", gap: "4px" }}>
          {(["ATIVOS", "INATIVOS"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              role="radio"
              aria-checked={statusFilter === s}
              variant={statusFilter === s ? "primary" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "ATIVOS" ? "Ativos" : "Inativos / Legados"}
            </Button>
          ))}
        </div>
      </div>

      {plansByUnit.length === 0 && (
        <p style={{ color: "var(--text-secondary)" }}>Nenhum plano {statusFilter === "ATIVOS" ? "ativo" : "inativo"} para esse filtro.</p>
      )}

      {plansByUnit.map(({ unit, items }) => (
        <section key={unit.id} style={{ marginBottom: "20px" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "15px", margin: "0 0 8px" }}>{unit.name}</h3>
          {items.map((p) => (
            <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block" }} />
                {p.name} — {p.durationValue} {p.durationUnit.toLowerCase()}
                {!p.active && <Badge variant="neutral">Inativo</Badge>}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span>
                  {money(p.valueCents)} + {money(p.overageCentsPerMinute)}/min excedente
                </span>
                <Button variant="secondary" onClick={() => startEdit(p)} disabled={busy}>
                  Editar
                </Button>
                {p.active ? (
                  <Button variant="secondary" style={{ color: "var(--color-error-text)", borderColor: "var(--color-error-text)" }} onClick={() => handleToggleActive(p)} disabled={busy}>
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
        </section>
      ))}
    </div>
  );
}
