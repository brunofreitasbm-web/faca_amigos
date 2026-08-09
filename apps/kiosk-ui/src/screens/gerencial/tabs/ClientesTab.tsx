import { useEffect, useMemo, useState } from "react";
import { Card, Button, Badge, Input } from "@facaamigos/ui";
import { formatCpf, formatPhoneBr } from "@facaamigos/domain";
import { Api } from "../../../api/client.js";
import type { ChildMatch, SessionAudit } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { unitBrandFor } from "../../../branding/unitBrand.js";
import { formatAge } from "../../../format.js";

const SESSION_STATUS_LABEL: Record<string, string> = {
  ATIVA: "No parque",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  FINALIZADA: "Finalizada",
};

/**
 * Busca de clientes — só no Gerencial, e não em cada operação, porque o
 * histórico que importa aqui é da criança como um todo: playground e
 * circuito são unidades (unit_id) separadas, e um botão dentro de cada
 * operação levaria a crer, por engano, que o histórico é só daquela
 * unidade. Busca e histórico aqui nunca filtram por unidade.
 */
export function ClientesTab() {
  const { units } = useAppState();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ChildMatch | null>(null);
  const [sessions, setSessions] = useState<SessionAudit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (selected || trimmed.length < 2) {
      setMatches([]);
      return;
    }
    // Mesmo truque da tela de Entrada: telefone é salvo em E.164, então um
    // texto mascarado como "(91) 98250-…" nunca bateria no ilike — só os
    // dígitos batem.
    const digits = trimmed.replace(/\D/g, "");
    const term = digits.length >= 3 && digits.length >= trimmed.length - 4 ? digits : trimmed;
    setSearching(true);
    const handle = setTimeout(() => {
      Api.searchChildren(term)
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => clearTimeout(handle);
  }, [query, selected]);

  useEffect(() => {
    if (!selected) {
      setSessions([]);
      return;
    }
    setLoadingHistory(true);
    Api.childSessionHistory(selected.id)
      .then(setSessions)
      .catch(() => {
        setSessions([]);
        toast.error("Não foi possível carregar o histórico desta criança.");
      })
      .finally(() => setLoadingHistory(false));
  }, [selected]);

  function unitLabel(unitId: string): string {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return "—";
    return unitBrandFor(unit.name).title;
  }

  const summary = useMemo(() => {
    const byActivity = { PLAYGROUND: 0, CARRINHO: 0 } as Record<"PLAYGROUND" | "CARRINHO", number>;
    for (const s of sessions) byActivity[s.activity] += 1;
    const checkins = sessions.map((s) => s.checkin_at_ms);
    return {
      total: sessions.length,
      byActivity,
      firstVisitMs: checkins.length > 0 ? Math.min(...checkins) : null,
      lastVisitMs: checkins.length > 0 ? Math.max(...checkins) : null,
    };
  }, [sessions]);

  function backToSearch() {
    setSelected(null);
    setSessions([]);
  }

  return (
    <div>
      {!selected && (
        <>
          <Input
            label="Buscar cliente"
            placeholder="Ex.: Helena, nome do responsável, telefone ou CPF"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />

          {searching && (
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "12px" }}>Buscando…</p>
          )}

          {!searching && query.trim().length >= 2 && matches.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "12px" }}>
              Nenhum cliente encontrado para "{query.trim()}".
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" }}>
            {matches.map((m) => (
              <Card
                key={m.id}
                onClick={() => setSelected(m)}
                style={{ padding: "16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "15px", color: "var(--text-primary)" }}>{m.full_name}</strong>
                    {m.is_vip && <Badge variant="vip">VIP</Badge>}
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                    Responsável: {m.guardian_name ?? "—"}
                    {m.phone_e164 ? ` · ${formatPhoneBr(m.phone_e164)}` : ""}
                    {m.cpf ? ` · ${formatCpf(m.cpf)}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm">Ver histórico ➔</Button>
              </Card>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div>
          <Button variant="ghost" size="sm" onClick={backToSearch} style={{ marginBottom: "16px" }}>
            ← Nova busca
          </Button>

          <Card style={{ padding: "20px", marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0, color: "var(--text-primary)" }}>
                    {selected.full_name}
                  </h2>
                  {selected.is_vip && <Badge variant="vip">VIP</Badge>}
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
                  {formatAge(selected.birth_date)} · Responsável: {selected.guardian_name ?? "—"}
                  {selected.phone_e164 ? ` · ${formatPhoneBr(selected.phone_e164)}` : ""}
                  {selected.cpf ? ` · ${formatCpf(selected.cpf)}` : ""}
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Badge variant="teal">{summary.total} visita{summary.total === 1 ? "" : "s"} ao todo</Badge>
                <Badge variant="pink">🏰 Playground: {summary.byActivity.PLAYGROUND}</Badge>
                <Badge variant="teal">🏎️ Circuito: {summary.byActivity.CARRINHO}</Badge>
              </div>
            </div>

            {summary.firstVisitMs && summary.lastVisitMs && (
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "12px 0 0 0" }}>
                Primeira visita: {new Date(summary.firstVisitMs).toLocaleDateString("pt-BR")} · Última visita:{" "}
                {new Date(summary.lastVisitMs).toLocaleDateString("pt-BR")}
              </p>
            )}
          </Card>

          {loadingHistory && <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Carregando histórico…</p>}

          {!loadingHistory && sessions.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Nenhuma visita registrada ainda.</p>
          )}

          {!loadingHistory && sessions.length > 0 && (
            <Card style={{ padding: "8px", overflowX: "auto" }}>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Unidade</th>
                    <th>Entrada</th>
                    <th>Saída</th>
                    <th>Status</th>
                    <th>Plano</th>
                    <th>Atendido por</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontSize: "12px" }}>{unitLabel(s.unit_id)}</td>
                      <td>{new Date(s.checkin_at_ms).toLocaleString("pt-BR")}</td>
                      <td>{s.checkout_at_ms ? new Date(s.checkout_at_ms).toLocaleString("pt-BR") : "—"}</td>
                      <td>{SESSION_STATUS_LABEL[s.status] ?? s.status}</td>
                      <td>{s.plan_name ?? "—"}</td>
                      <td>{s.employee_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
