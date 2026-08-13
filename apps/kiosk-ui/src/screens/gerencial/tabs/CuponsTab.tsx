import { useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Coupon, Plan } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

function planLabel(p: Plan): string {
  const duration = p.durationUnit === "HORA" ? `${p.durationValue}h` : `${p.durationValue}min`;
  return `${p.name} (${duration})`;
}

export function CuponsTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Coupon["kind"]>("MINUTOS_EXTRA");
  const [value, setValue] = useState("10");
  const [description, setDescription] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [allowedPlanId, setAllowedPlanId] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    Api.couponsAllUnits().then(setCoupons);
    Api.plansAllUnits().then(setPlans);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  // Restringir a um plano só faz sentido quando dá para saber a que unidade
  // o cupom pertence — na edição (uma unidade só) ou na criação quando o
  // operador restringiu a seleção a uma única unidade.
  const planRestrictionUnitId = editingId
    ? coupons.find((c) => c.id === editingId)?.unitId
    : unitIds.length === 1
      ? unitIds[0]
      : undefined;
  const plansForRestriction = plans.filter((p) => p.unitId === planRestrictionUnitId);

  function startEdit(c: Coupon) {
    setEditingId(c.id);
    setCode(c.code);
    setKind(c.kind);
    setValue(String(c.value));
    setDescription(c.description ?? "");
    setAllowedPlanId(c.allowedPlanId ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setCode("");
    setKind("MINUTOS_EXTRA");
    setValue("10");
    setDescription("");
    setUnitIds(units.map((u) => u.id));
    setAllowedPlanId("");
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        code,
        kind,
        value: Number(value),
        description: description || undefined,
        allowedPlanId: planRestrictionUnitId ? allowedPlanId || null : null,
      };

      if (editingId) {
        await Api.updateCoupon(editingId, payload);
        toast.success("Cupom atualizado.");
      } else {
        await Promise.all(unitIds.map((unitId) => Api.createCoupon({ unitId, ...payload })));
        toast.success(`Cupom criado em ${unitIds.length} unidade(s).`);
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o cupom.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(c: Coupon) {
    if (!window.confirm(`Deseja realmente ${c.active ? "inativar/excluir" : "reativar"} o cupom "${c.code}"?`)) return;
    try {
      await Api.setCouponActive(c.id, !c.active);
      toast.success(c.active ? "Cupom removido com sucesso." : "Cupom reativado.");
      load();
    } catch {
      toast.error("Não foi possível alterar o cupom.");
    }
  }

  const reviewCoupons = coupons.filter((c) => c.description === "10% desconto - 5 Avaliação Google");
  const totalReviewIssued = reviewCoupons.length;
  const totalReviewUsed = reviewCoupons.reduce((acc, c) => acc + c.used_count, 0);

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", background: "var(--surface-sunken)", borderLeft: "4px solid var(--color-primary)", borderRadius: "12px" }}>
        <h3 style={{ fontSize: "16px", margin: "0 0 8px 0", color: "var(--text-primary)" }}>⭐ Desempenho: Avaliações do Google</h3>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
          <strong>{totalReviewIssued}</strong> descontos (cupons) emitidos <br/>
          <strong>{totalReviewUsed}</strong> resgatados pelos clientes ({totalReviewIssued > 0 ? Math.round((totalReviewUsed / totalReviewIssued) * 100) : 0}% de conversão)
        </p>
      </Card>

      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar cupom" : "Novo cupom"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Código" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as Coupon["kind"])}>
          <option value="MINUTOS_EXTRA">Minutos extras</option>
          <option value="DESCONTO_PCT">Desconto %</option>
          <option value="DESCONTO_VALOR">Desconto em R$</option>
        </Select>
        <Input label="Valor" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <Input label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        {planRestrictionUnitId ? (
          <Select label="Restringir a um plano" value={allowedPlanId} onChange={(e) => setAllowedPlanId(e.target.value)}>
            <option value="">Vale para todos os planos da unidade</option>
            {plansForRestriction.map((p) => (
              <option key={p.id} value={p.id}>
                {planLabel(p)}
              </option>
            ))}
          </Select>
        ) : (
          !editingId && unitIds.length > 1 && (
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
              Restrição de plano só pode ser definida ao criar o cupom em uma única unidade.
            </p>
          )
        )}
        <Button variant="primary" disabled={busy || !code || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar cupom" : `Criar cupom em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>
      {coupons.map((c) => (
        <Card key={c.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: c.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
          <span>
            <strong>{c.code}</strong> — {c.kind} ({c.value}) — usado {c.used_count}× {c.description ? `— ${c.description}` : ""}
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}> · {units.find((u) => u.id === c.unitId)?.name ?? "—"}</span>
            {c.allowedPlanId && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {" "}
                · só no plano {planLabel(plans.find((p) => p.id === c.allowedPlanId) ?? ({ name: "?", durationValue: 0, durationUnit: "MINUTO" } as Plan))}
              </span>
            )}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Button variant="secondary" onClick={() => startEdit(c)} disabled={busy}>
              Editar
            </Button>
            {c.active ? (
              <Button variant="secondary" style={{ color: "#d32f2f", borderColor: "#d32f2f" }} onClick={() => handleToggleActive(c)} disabled={busy}>
                Excluir
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => handleToggleActive(c)} disabled={busy}>
                Reativar
              </Button>
            )}
          </span>
        </Card>
      ))}
    </div>
  );
}
