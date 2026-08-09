import { useEffect, useState } from "react";
import { Card, Input, Button, Tag, AsyncState, Badge } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { GerencialCliente, Unit } from "../../../api/client.js";
import { formatPhoneBr } from "@facaamigos/domain";

export function ClientesTab() {
  const [search, setSearch] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [clientes, setClientes] = useState<GerencialCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCliente, setSelectedCliente] = useState<GerencialCliente | null>(null);

  useEffect(() => {
    Api.units().then(setUnits).catch(() => setUnits([]));
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const data = await Api.gerencialClientes(search.trim() || undefined, selectedUnitId || undefined);
      setClientes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os clientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadData, 300);
    return () => clearTimeout(timer);
  }, [search, selectedUnitId]);

  const totalGuardians = clientes.length;
  const totalChildren = clientes.reduce((acc, c) => acc + (c.children?.length || 0), 0);
  const totalVisits = clientes.reduce((acc, c) => acc + (c.total_visits || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Resumo de Indicadores da Base */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        <Card style={{ padding: "16px", borderRadius: "16px", background: "var(--color-surface)" }}>
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Total de Responsáveis</span>
          <strong style={{ display: "block", fontSize: "28px", marginTop: "4px", color: "var(--color-primary)" }}>
            {totalGuardians}
          </strong>
        </Card>
        <Card style={{ padding: "16px", borderRadius: "16px", background: "var(--color-surface)" }}>
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Crianças Vinculadas</span>
          <strong style={{ display: "block", fontSize: "28px", marginTop: "4px", color: "var(--color-text)" }}>
            {totalChildren}
          </strong>
        </Card>
        <Card style={{ padding: "16px", borderRadius: "16px", background: "var(--color-surface)" }}>
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Visitas Registradas</span>
          <strong style={{ display: "block", fontSize: "28px", marginTop: "4px", color: "#10b981" }}>
            {totalVisits}
          </strong>
        </Card>
      </div>

      {/* Barra de Busca e Filtros */}
      <Card style={{ padding: "20px", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar responsável, criança, CPF ou telefone..."
              aria-label="Buscar clientes"
            />
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "14px",
              }}
            >
              <option value="">Todas as Unidades</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={loadData} title="Recarregar lista">
              🔄 Atualizar
            </Button>
          </div>
        </div>

        {/* Tabela de Clientes */}
        {loading && <AsyncState kind="loading" title="Buscando base de clientes..." />}
        {error && <AsyncState kind="error" title="Erro ao carregar clientes" detail={error} />}

        {!loading && !error && clientes.length === 0 && (
          <AsyncState
            kind="empty"
            title={search ? "Nenhum cliente encontrado para esta busca." : "Nenhum cliente cadastrado até o momento."}
          />
        )}

        {!loading && !error && clientes.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                  <th style={{ padding: "12px 8px" }}>Responsável</th>
                  <th style={{ padding: "12px 8px" }}>Telefone / CPF</th>
                  <th style={{ padding: "12px 8px" }}>Crianças Vinculadas</th>
                  <th style={{ padding: "12px 8px", textAlign: "center" }}>Visitas</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr
                    key={c.guardian_id}
                    style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                    onClick={() => setSelectedCliente(c)}
                  >
                    <td style={{ padding: "14px 8px", fontWeight: "600", color: "var(--color-text)" }}>
                      <div>{c.guardian_name}</div>
                      {c.email && (
                        <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: "normal" }}>
                          {c.email}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "14px 8px", color: "var(--color-text-muted)" }}>
                      <div>{c.phone_e164 ? formatPhoneBr(c.phone_e164) : "—"}</div>
                      {c.cpf && <span style={{ fontSize: "12px" }}>CPF: {c.cpf}</span>}
                    </td>
                    <td style={{ padding: "14px 8px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {c.children && c.children.length > 0 ? (
                          c.children.map((ch) => (
                            <Tag key={ch.id} color="primary">
                              🧒 {ch.fullName}
                            </Tag>
                          ))
                        ) : (
                          <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>Nenhuma criança</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "center" }}>
                      <Badge variant={c.total_visits > 5 ? "green" : "neutral"}>
                        {c.total_visits} {c.total_visits === 1 ? "visita" : "visitas"}
                      </Badge>
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right" }}>
                      <Button size="sm" variant="secondary" onClick={() => setSelectedCliente(c)}>
                        Ver detalhes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal de Detalhes do Cliente */}
      {selectedCliente && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
            padding: "20px",
          }}
          onClick={() => setSelectedCliente(null)}
        >
          <div
            style={{
              background: "var(--color-surface)",
              borderRadius: "20px",
              maxWidth: "540px",
              width: "100%",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              boxShadow: "var(--shadow-xl)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "20px", fontFamily: "var(--font-display)" }}>
                👤 {selectedCliente.guardian_name}
              </h3>
              <Button variant="secondary" size="sm" onClick={() => setSelectedCliente(null)}>
                ✖ Fechar
              </Button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
              <div>
                <strong>Telefone:</strong> {selectedCliente.phone_e164 ? formatPhoneBr(selectedCliente.phone_e164) : "Não informado"}
              </div>
              <div>
                <strong>CPF:</strong> {selectedCliente.cpf || "Não informado"}
              </div>
              <div>
                <strong>E-mail:</strong> {selectedCliente.email || "Não informado"}
              </div>
              <div>
                <strong>Total de Visitas:</strong> {selectedCliente.total_visits}
              </div>
            </div>

            <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: 0 }} />

            <div>
              <h4 style={{ margin: "0 0 12px 0", fontSize: "16px" }}>Crianças Cadastradas</h4>
              {selectedCliente.children && selectedCliente.children.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {selectedCliente.children.map((ch) => (
                    <div
                      key={ch.id}
                      style={{
                        padding: "12px",
                        borderRadius: "12px",
                        background: "var(--color-background)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <strong>🧒 {ch.fullName}</strong>
                        {ch.birthDate && (
                          <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                            Nascido em: {new Date(ch.birthDate).toLocaleDateString("pt-BR")}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ color: "var(--color-text-muted)" }}>Nenhuma criança cadastrada para este responsável.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
