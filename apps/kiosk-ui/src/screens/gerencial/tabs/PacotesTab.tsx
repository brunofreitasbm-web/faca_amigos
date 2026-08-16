import { useEffect, useState } from "react";
import { Button, Card, HelpText, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Package, Unit } from "../../../api/client.js";
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

/**
 * Só o catálogo de pacotes. As regras do motor VIP (limiar de visitas,
 * janela, cooldown) e o cross-sell rápido continuam só na Configurações de
 * cada unidade — são calibragem operacional do terminal, não preço.
 */
export function PacotesTab() {
  const toast = useToast();
  const { units } = useAppState();

  const [packages, setPackages] = useState<Package[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("0");
  const [includedHours, setIncludedHours] = useState("10");
  const [validityDays, setValidityDays] = useState("30");
  const [benefitText, setBenefitText] = useState("");
  const [color, setColor] = useState("#FF7A00");
  const [overageReais, setOverageReais] = useState("0");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);

  function load() {
    Api.packagesAllUnits().then(setPackages).catch(() => {});
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  const priceCents = Math.round(Number(priceReais) * 100);
  const includedMinutes = Math.round(Number(includedHours) * 60);
  const hourlyCents = includedMinutes > 0 ? Math.round((priceCents * 60) / includedMinutes) : 0;

  function startEdit(p: Package) {
    setEditingId(p.id);
    setName(p.name);
    setPriceReais((p.priceCents / 100).toFixed(2));
    setIncludedHours(String(p.includedMinutes / 60));
    setValidityDays(String(p.validityDays));
    setBenefitText(p.benefitText);
    setColor(p.color);
    setOverageReais((p.overageCentsPerMinute / 100).toFixed(2));
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setPriceReais("0");
    setIncludedHours("10");
    setValidityDays("30");
    setBenefitText("");
    setColor("#FF7A00");
    setOverageReais("0");
    setUnitIds(units.map((u) => u.id));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name,
        priceCents,
        includedMinutes,
        validityDays: Math.max(1, Math.round(Number(validityDays))),
        benefitText: benefitText.trim(),
        color,
        overageCentsPerMinute: Math.round(Number(overageReais) * 100),
      };

      if (editingId) {
        await Api.updatePackage(editingId, payload);
        toast.success("Pacote atualizado.");
      } else {
        await Promise.all(
          unitIds.map((unitId) => {
            const unit = units.find((u) => u.id === unitId)!;
            return Api.createPackage({ unitId, activity: activityForUnit(unit), ...payload });
          }),
        );
        toast.success(`Pacote criado em ${unitIds.length} unidade(s).`);
      }
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o pacote.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(pkg: Package) {
    if (!window.confirm(`Deseja realmente ${pkg.active ? "inativar/excluir" : "reativar"} o pacote "${pkg.name}"?`)) return;
    try {
      await Api.setPackageActive(pkg.id, !pkg.active);
      toast.success(pkg.active ? "Pacote removido com sucesso." : "Pacote reativado.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar o pacote.");
    }
  }

  const canCreate = Boolean(name.trim()) && Boolean(benefitText.trim()) && priceCents > 0 && includedMinutes > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{editingId ? "Editar pacote" : "Novo pacote"}</h2>
          {editingId && (
            <Button variant="secondary" onClick={cancelEdit} disabled={busy}>
              Cancelar Edição
            </Button>
          )}
        </div>
        <Input label="Nome do pacote" placeholder="Ex.: Pacote Amigo 10h" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Valor de tabela (R$)" type="number" value={priceReais} onChange={(e) => setPriceReais(e.target.value)} />
        <Input label="Horas incluídas" type="number" step="0.5" value={includedHours} onChange={(e) => setIncludedHours(e.target.value)} />
        <Input label="Validade (dias)" type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
        <Input
          label="Excedente por minuto (R$)"
          type="number"
          value={overageReais}
          onChange={(e) => setOverageReais(e.target.value)}
          title="Valor cobrado por minuto além do incluído, quando o pacote é usado direto na Entrada"
        />
        <Input label="Benefício (frase do script de venda)" placeholder="Ex.: 2 horas extras e um lanche por visita" value={benefitText} onChange={(e) => setBenefitText(e.target.value)} />
        <div>
          <label>Cor do pacote</label>
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
        {includedMinutes > 0 && priceCents > 0 && (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Custo por hora deste pacote: <strong>{money(hourlyCents)}</strong>
          </div>
        )}
        {!editingId && <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />}
        <Button variant="primary" disabled={busy || !canCreate || (!editingId && unitIds.length === 0)} onClick={save}>
          {editingId ? "Salvar pacote" : `Criar pacote em ${unitIds.length} unidade(s)`}
        </Button>
      </Card>

      {packages.map((p) => {
        const hourly = Math.round((p.priceCents * 60) / p.includedMinutes);
        return (
          <Card key={p.id} style={{ padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", opacity: p.active ? 1 : 0.5, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
              <span>
                <strong>{p.name}</strong>
                <br />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {(p.includedMinutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h · {p.validityDays} dias ·{" "}
                  {p.benefitText} · {units.find((u) => u.id === p.unitId)?.name ?? "—"}
                </span>
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <strong>{money(p.priceCents)}</strong>
                <br />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{money(hourly)}/h</span>
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
        );
      })}

      <HelpText>
        Regras do motor VIP e cross-sell rápido continuam em Configurações › Pacotes, dentro de cada unidade — são
        calibragem do terminal, não preço de catálogo.
      </HelpText>
    </div>
  );
}
