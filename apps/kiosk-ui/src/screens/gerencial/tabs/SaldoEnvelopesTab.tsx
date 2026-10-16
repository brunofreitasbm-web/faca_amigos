import { useEffect, useMemo, useState } from "react";
import { HelpText, Button } from "@facaamigos/ui";
import { Card } from "../GCard.js";
import { Api } from "../../../api/client.js";
import type { UnitEnvelopeBalance, UnitCashStatus, PendingEnvelope } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

export function SaldoEnvelopesTab() {
  const { employee } = useAppState();
  const [balances, setBalances] = useState<UnitEnvelopeBalance[]>([]);
  const [cashStatus, setCashStatus] = useState<UnitCashStatus[]>([]);
  const [pending, setPending] = useState<PendingEnvelope[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  // Seleção de uma loja por vez: trocar de loja descarta a seleção anterior.
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function loadData() {
    setLoading(true);
    try {
      const [envelopes, cash, list] = await Promise.all([Api.unitsEnvelopeBalance(), Api.unitsCashStatus(), Api.pendingEnvelopes()]);
      setBalances(envelopes);
      setCashStatus(cash);
      setPending(list);
      // Só mantém marcados os que ainda estão pendentes (outro gestor pode ter recolhido).
      const stillPending = new Set(list.map((e) => e.movement_id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => stillPending.has(id))));
    } catch {
      // mantém os dados anteriores na tela em caso de falha
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    Api.allEmployees()
      .then((list) => setEmployeeNames(new Map(list.map((e) => [e.id, e.full_name]))))
      .catch(() => {});
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const pendingByUnit = useMemo(() => {
    const map = new Map<string, PendingEnvelope[]>();
    for (const e of pending) {
      const list = map.get(e.unit_id) ?? [];
      list.push(e);
      map.set(e.unit_id, list);
    }
    return map;
  }, [pending]);

  function toggle(unitId: string, id: string) {
    if (selectedUnit !== unitId) {
      setSelectedUnit(unitId);
      setSelectedIds(new Set([id]));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(unitId: string) {
    setSelectedUnit(unitId);
    setSelectedIds(new Set((pendingByUnit.get(unitId) ?? []).map((e) => e.movement_id)));
  }

  function clearSelection() {
    setSelectedUnit(null);
    setSelectedIds(new Set());
  }

  async function handleCollect(b: UnitEnvelopeBalance, chosen: PendingEnvelope[]) {
    if (!employee || chosen.length === 0) return;
    const total = chosen.reduce((sum, e) => sum + e.amount_cents, 0);
    const ok = window.confirm(
      `Confirmar recolhimento de ${chosen.length} envelope(s) da loja ${b.unit_name}, totalizando ${money(total)}?\n\nUse apenas quando os envelopes forem retirados fisicamente da loja.`,
    );
    if (!ok) return;
    setCollecting(true);
    try {
      const res = await Api.collectSelectedEnvelopes(
        b.unit_id,
        employee.id,
        chosen.map((e) => e.movement_id),
      );
      if (res.collected_count !== res.requested_count) {
        alert(
          `Atenção: ${res.collected_count} de ${res.requested_count} envelope(s) foram recolhidos (${money(res.collected_cents)}). Algum já tinha sido recolhido por outra pessoa.`,
        );
      }
      clearSelection();
      await loadData();
    } catch {
      alert("Erro ao registrar o recolhimento. Tente novamente.");
    } finally {
      setCollecting(false);
    }
  }

  const totalPendente = balances.reduce((sum, b) => sum + b.pending_cents, 0);
  const cashByUnit = new Map(cashStatus.map((s) => [s.unit_id, s]));

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <HelpText>
              Cada envelope de sangria ainda na loja. Marque os que você está retirando (uma loja por vez) e use "Recolher selecionados" — o
              total acompanha a seleção.
            </HelpText>
          </div>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            🔄 Atualizar
          </Button>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        {balances.map((b) => {
          const cash = cashByUnit.get(b.unit_id);
          const envelopes = pendingByUnit.get(b.unit_id) ?? [];
          const chosen = selectedUnit === b.unit_id ? envelopes.filter((e) => selectedIds.has(e.movement_id)) : [];
          const chosenCents = chosen.reduce((sum, e) => sum + e.amount_cents, 0);
          return (
            <Card
              key={b.unit_id}
              style={{
                padding: "18px",
                borderTop: `4px solid ${b.pending_count > 0 ? "var(--color-primary)" : "var(--border-subtle)"}`,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>{b.unit_name}</span>
              <h3
                style={{
                  fontSize: "28px",
                  margin: "4px 0 0 0",
                  color: b.pending_count > 0 ? "var(--color-primary)" : "var(--text-muted)",
                }}
              >
                {money(b.pending_cents)}
              </h3>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {b.pending_count > 0
                  ? `✉️ ${b.pending_count} envelope(s) na loja${b.oldest_pending_at_ms ? ` · mais antigo em ${new Date(b.oldest_pending_at_ms).toLocaleDateString("pt-BR")}` : ""}`
                  : "Nenhum envelope aguardando recolhimento"}
              </span>
              {b.last_collected_at_ms && (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Último recolhimento em {new Date(b.last_collected_at_ms).toLocaleString("pt-BR")}
                </span>
              )}
              {cash?.status === "ABERTO" && (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  💵 Na gaveta agora: {money(cash.current_cash_cents ?? 0)} (turno aberto)
                </span>
              )}

              {envelopes.length > 0 && (
                <>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    <Button variant="secondary" size="sm" disabled={collecting} onClick={() => selectAll(b.unit_id)}>
                      Selecionar todos
                    </Button>
                    {chosen.length > 0 && (
                      <Button variant="secondary" size="sm" disabled={collecting} onClick={clearSelection}>
                        Limpar
                      </Button>
                    )}
                  </div>
                  <ul
                    style={{
                      listStyle: "none",
                      margin: "8px 0 0 0",
                      padding: 0,
                      maxHeight: "320px",
                      overflowY: "auto",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                    }}
                  >
                    {envelopes.map((e) => {
                      const checked = chosen.some((c) => c.movement_id === e.movement_id);
                      return (
                        <li key={e.movement_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <label
                            style={{
                              display: "flex",
                              gap: "10px",
                              alignItems: "flex-start",
                              padding: "8px 10px",
                              cursor: collecting ? "default" : "pointer",
                              background: checked ? "var(--bg-subtle, rgba(0,0,0,0.04))" : "transparent",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={collecting}
                              onChange={() => toggle(b.unit_id, e.movement_id)}
                              style={{ marginTop: "3px" }}
                            />
                            <span style={{ display: "flex", flexDirection: "column", flex: 1, fontSize: "12px", gap: "2px" }}>
                              <span style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                                <strong>Envelope nº {e.envelope_number}</strong>
                                <strong>{money(e.amount_cents)}</strong>
                              </span>
                              <span style={{ color: "var(--text-secondary)" }}>
                                {new Date(e.at_ms).toLocaleString("pt-BR")} · {employeeNames.get(e.employee_id) ?? "Operador"}
                              </span>
                              {e.reason && <span style={{ color: "var(--text-muted)" }}>{e.reason}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      marginTop: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      {chosen.length} de {envelopes.length} selecionado(s) · <strong>{money(chosenCents)}</strong>
                    </span>
                    <Button
                      size="sm"
                      loading={collecting}
                      disabled={chosen.length === 0 || collecting}
                      onClick={() => handleCollect(b, chosen)}
                    >
                      ✅ Recolher selecionados
                    </Button>
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <Card style={{ padding: "16px" }}>
        <HelpText>
          Total em envelopes aguardando recolhimento em todas as lojas: <strong>{money(totalPendente)}</strong>
        </HelpText>
      </Card>
    </div>
  );
}
