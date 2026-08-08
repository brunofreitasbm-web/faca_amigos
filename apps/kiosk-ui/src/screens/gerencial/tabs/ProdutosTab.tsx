import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Product } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

export function ProdutosTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("0");
  const [stock, setStock] = useState("0");
  const [emoji, setEmoji] = useState("🛍️");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.productsAllUnits().then(setProducts);
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setName(p.name);
    setPriceReais((p.price_cents / 100).toFixed(2));
    setStock(String(p.stock));
    setEmoji(p.emoji ?? "🛍️");
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setPriceReais("0");
    setStock("0");
    setEmoji("🛍️");
    setUnitIds(units.map((u) => u.id));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = { name, emoji, priceCents: Math.round(Number(priceReais) * 100), stock: Number(stock) };

      if (editingId) {
        await Api.updateProduct(editingId, payload);
        toast.success("Produto atualizado.");
      } else {
        await Promise.all(unitIds.map((unitId) => Api.createProduct({ unitId, ...payload })));
        toast.success(`Produto criado em ${unitIds.length} unidade(s).`);
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(p: Product) {
    if (!window.confirm(`Deseja realmente ${p.active ? "inativar/excluir" : "reativar"} o produto "${p.name}"?`)) return;
    try {
      await Api.setProductActive(p.id, !p.active);
      toast.success(p.active ? "Produto removido com sucesso." : "Produto reativado.");
      load();
    } catch {
      toast.error("Não foi possível alterar o produto.");
    }
  }

  return (
    <div>
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px" }}>
            {editingId ? "Editar produto" : "Novo produto"}
          </h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Preço (R$)" type="number" value={priceReais} onChange={(e) => setPriceReais(e.target.value)} />
        <Input label="Estoque" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        <Button variant="primary" disabled={busy || !name || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar produto" : `Criar produto em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>
      {products.map((p) => (
        <Card key={p.id} style={{ padding: "12px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: p.active ? 1 : 0.5, flexWrap: "wrap", gap: "8px" }}>
          <span>
            {p.emoji} {p.name}
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}> · {units.find((u) => u.id === p.unit_id)?.name ?? "—"}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>
              {money(p.price_cents)} — {p.stock} un.
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
