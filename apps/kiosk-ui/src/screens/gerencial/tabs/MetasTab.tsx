import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { BonusRule, TicketGoal } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { money } from "../../../format.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";
import { IfCan } from "../../../auth/RequireCapability.js";
import { useAuth } from "../../../auth/AuthContext.js";

/**
 * Regras de bonificação + meta de Ticket Médio (mínimo/alvo) por unidade.
 * A meta diária de faturamento e o horário de fechamento (aba "Meta" da
 * Configurações por unidade) continuam de fora daqui — são ajustes
 * operacionais de cada terminal, não uma configuração macro (ver plano).
 * Ticket Médio é diferente: é um benchmark estratégico do Owner sobre a
 * unidade, por isso mora no Gerencial e só o Owner (capability
 * metas.ticket.write) pode editar — Líder/Operador só enxergam o valor.
 */
export function MetasTab() {
  const toast = useToast();
  const { units } = useAppState();
  const { can } = useAuth();

  const [ticketGoals, setTicketGoals] = useState<Record<string, { minReais: string; targetReais: string }>>({});
  const [ticketBusyUnitId, setTicketBusyUnitId] = useState<string | null>(null);

  function loadTicketGoals() {
    Promise.all(units.map((u) => Api.ticketGoal(u.id).then((g): [string, TicketGoal | null] => [u.id, g]))).then((pairs) => {
      const next: Record<string, { minReais: string; targetReais: string }> = {};
      for (const [unitId, g] of pairs) {
        next[unitId] = { minReais: ((g?.minTicketCents ?? 0) / 100).toFixed(2), targetReais: ((g?.targetTicketCents ?? 0) / 100).toFixed(2) };
      }
      setTicketGoals(next);
    });
  }
  useEffect(loadTicketGoals, [units]);

  async function saveTicketGoal(unitId: string) {
    const g = ticketGoals[unitId];
    if (!g) return;
    setTicketBusyUnitId(unitId);
    try {
      await Api.setTicketGoal(unitId, Math.round(Number(g.minReais) * 100), Math.round(Number(g.targetReais) * 100));
      toast.success("Meta de Ticket Médio salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a meta.");
    } finally {
      setTicketBusyUnitId(null);
    }
  }

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
      <Card style={{ padding: "16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 title="Faixas que alimentam o termômetro de Ticket Médio no Painel de cada unidade">
          Meta de Ticket Médio
          {!can("metas.ticket.write") && <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}> (só o Owner edita)</span>}
        </h2>
        {units.map((u) => {
          const g = ticketGoals[u.id];
          if (!g) return null;
          return (
            <div key={u.id} style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
              <strong style={{ minWidth: "140px" }}>{u.name}</strong>
              <IfCan capability="metas.ticket.write">
                <div style={{ width: "140px" }}>
                  <Input
                    label="Mínimo (R$)"
                    type="number"
                    value={g.minReais}
                    onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, minReais: e.target.value } }))}
                  />
                </div>
                <div style={{ width: "140px" }}>
                  <Input
                    label="Alvo (R$)"
                    type="number"
                    value={g.targetReais}
                    onChange={(e) => setTicketGoals((prev) => ({ ...prev, [u.id]: { ...g, targetReais: e.target.value } }))}
                  />
                </div>
                <Button variant="primary" disabled={ticketBusyUnitId === u.id} onClick={() => saveTicketGoal(u.id)}>
                  Salvar
                </Button>
              </IfCan>
              {!can("metas.ticket.write") && (
                <span style={{ fontSize: "14px" }}>
                  Mínimo: {money(Math.round(Number(g.minReais) * 100))} · Alvo: {money(Math.round(Number(g.targetReais) * 100))}
                </span>
              )}
            </div>
          );
        })}
      </Card>
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
