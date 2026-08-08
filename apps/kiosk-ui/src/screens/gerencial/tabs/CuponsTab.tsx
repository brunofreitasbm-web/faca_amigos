import { useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Coupon } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

export function CuponsTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Coupon["kind"]>("MINUTOS_EXTRA");
  const [value, setValue] = useState("10");
  const [description, setDescription] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.couponsAllUnits().then(setCoupons);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  function startEdit(c: Coupon) {
    setEditingId(c.id);
    setCode(c.code);
    setKind(c.kind);
    setValue(String(c.value));
    setDescription(c.description ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setCode("");
    setKind("MINUTOS_EXTRA");
    setValue("10");
    setDescription("");
    setUnitIds(units.map((u) => u.id));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = { code, kind, value: Number(value), description: description || undefined };

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

  return (
    <div>
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
        <Button variant="primary" disabled={busy || !code || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar cupom" : `Criar cupom em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>
      {coupons.map((c) => (
        <Card key={c.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: c.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
          <span>
            <strong>{c.code}</strong> — {c.kind} ({c.value}) — usado {c.used_count}× {c.description ? `— ${c.description}` : ""}
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}> · {units.find((u) => u.id === c.unitId)?.name ?? "—"}</span>
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
