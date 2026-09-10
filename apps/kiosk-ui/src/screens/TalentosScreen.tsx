import { useState, useMemo } from "react";
import { Card, Button, Badge, Modal, HelpText } from "@facaamigos/ui";
import type { Candidate, CandidateStatus, CandidateRole } from "@facaamigos/contracts";
import {
  getStoredCandidates,
  updateCandidateStatus,
  addCandidate,
  generateWhatsAppLink,
} from "../api/talentosApi.js";
import { useToast } from "../state/ToastContext.js";

const STATUS_LABELS: Record<CandidateStatus, string> = {
  NOVO: "Novo",
  EM_ANALISE: "Em Análise",
  ENTREVISTADO: "Entrevistado",
  CONTRATADO: "Contratado",
  BANCO_RESERVA: "Banco de Reserva",
  DESQUALIFICADO: "Desqualificado",
};

const STATUS_VARIANTS: Record<CandidateStatus, "teal" | "amber" | "neutral"> = {
  NOVO: "teal",
  EM_ANALISE: "amber",
  ENTREVISTADO: "teal",
  CONTRATADO: "teal",
  BANCO_RESERVA: "neutral",
  DESQUALIFICADO: "neutral",
};

const ROLE_LABELS: Record<CandidateRole, string> = {
  RECEPCAO: "Recepção / Check-in",
  VENDAS: "Vendas / Atendimento",
  MONITORIA: "Monitoria / Recreação",
  GERENCIA: "Gerência / Supervisão",
  LIMPEZA: "Higienização / Manutenção",
  OUTRO: "Outro Cargo",
};

export function TalentosScreen() {
  const toast = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>(() => getStoredCandidates());
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<CandidateStatus | "TODOS">("TODOS");
  const [selectedRole, setSelectedRole] = useState<CandidateRole | "TODOS">("TODOS");

  // Modais
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [editStatus, setEditStatus] = useState<CandidateStatus>("NOVO");
  const [editNotes, setEditNotes] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCity, setNewCity] = useState("Belém - PA");
  const [newUnit, setNewUnit] = useState("Ananindeua");
  const [newRole, setNewRole] = useState<CandidateRole>("VENDAS");
  const [newExp, setNewExp] = useState("");

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const matchSearch =
        search.trim() === "" ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.city.toLowerCase().includes(search.toLowerCase()) ||
        (c.preferredUnit && c.preferredUnit.toLowerCase().includes(search.toLowerCase())) ||
        (c.experienceSummary && c.experienceSummary.toLowerCase().includes(search.toLowerCase()));

      const matchStatus = selectedStatus === "TODOS" || c.status === selectedStatus;
      const matchRole = selectedRole === "TODOS" || c.role === selectedRole;

      return matchSearch && matchStatus && matchRole;
    });
  }, [candidates, search, selectedStatus, selectedRole]);

  const newCount = useMemo(() => candidates.filter((c) => c.status === "NOVO").length, [candidates]);

  function handleOpenDetails(cand: Candidate) {
    setSelectedCandidate(cand);
    setEditStatus(cand.status);
    setEditNotes(cand.notes || "");
  }

  function handleSaveDetails() {
    if (!selectedCandidate) return;
    const updated = updateCandidateStatus(selectedCandidate.id, editStatus, editNotes);
    setCandidates(updated);
    toast.success("Status do candidato atualizado com sucesso!");
    setSelectedCandidate(null);
  }

  function handleAddCandidate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) {
      toast.error("Nome e telefone são obrigatórios.");
      return;
    }
    const updated = addCandidate({
      name: newName.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim() || undefined,
      city: newCity.trim(),
      preferredUnit: newUnit,
      role: newRole,
      experienceSummary: newExp.trim() || "Cadastro manual de candidato.",
    });
    setCandidates(updated);
    toast.success("Novo candidato adicionado ao Banco de Talentos!");

    // Limpar formulário
    setNewName("");
    setNewPhone("");
    setNewEmail("");
    setNewExp("");
    setShowAddModal(false);
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: 0, color: "var(--text-primary)" }}>
              👥 Banco de Talentos & Recrutamento
            </h1>
            {newCount > 0 && (
              <Badge variant="teal" style={{ fontSize: "14px", padding: "4px 12px" }}>
                {newCount} Novo{newCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <HelpText style={{ marginTop: "4px" }}>
            Gerencie candidatos recebidos, faça triagem rápida de perfis de vendas e inicie contato via WhatsApp com 1 clique.
          </HelpText>
        </div>

        <Button variant="primary" onClick={() => setShowAddModal(true)} style={{ borderRadius: "9999px" }}>
          + Cadastrar Candidato Manualmente
        </Button>
      </div>

      {/* Barra de Filtros e Busca */}
      <Card style={{ padding: "20px", marginBottom: "24px", borderRadius: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "6px", color: "var(--text-muted)" }}>
              BUSCAR CANDIDATO
            </label>
            <input
              type="text"
              placeholder="Nome, cidade, palavra-chave..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-sunken)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "6px", color: "var(--text-muted)" }}>
              FILTRAR POR CARGO
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-sunken)",
                color: "var(--text-primary)",
              }}
            >
              <option value="TODOS">Todos os Cargos</option>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabs de Status */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
          <button
            onClick={() => setSelectedStatus("TODOS")}
            style={{
              padding: "6px 14px",
              borderRadius: "9999px",
              border: "none",
              fontSize: "13px",
              fontWeight: "bold",
              cursor: "pointer",
              background: selectedStatus === "TODOS" ? "var(--color-primary)" : "var(--surface-sunken)",
              color: selectedStatus === "TODOS" ? "#fff" : "var(--text-primary)",
            }}
          >
            Todos ({candidates.length})
          </button>
          {(Object.keys(STATUS_LABELS) as CandidateStatus[]).map((status) => {
            const count = candidates.filter((c) => c.status === status).length;
            const isSelected = selectedStatus === status;
            return (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "9999px",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  background: isSelected ? "var(--color-primary)" : "var(--surface-sunken)",
                  color: isSelected ? "#fff" : "var(--text-primary)",
                }}
              >
                {STATUS_LABELS[status]} ({count})
              </button>
            );
          })}
        </div>
      </Card>

      {/* Grid de Candidatos */}
      {filteredCandidates.length === 0 ? (
        <Card style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔍</div>
          <h3>Nenhum candidato encontrado</h3>
          <p style={{ margin: 0 }}>Tente ajustar seus termos de busca ou filtros acima.</p>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: "20px" }}>
          {filteredCandidates.map((cand) => {
            const waLink = generateWhatsAppLink(cand.phone, cand.name, ROLE_LABELS[cand.role] || cand.role);
            return (
              <Card
                key={cand.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "20px",
                  borderRadius: "16px",
                  position: "relative",
                  border: cand.status === "NOVO" ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "18px", color: "var(--text-primary)" }}>{cand.name}</h3>
                    <span style={{ fontSize: "13px", color: "var(--text-muted)", display: "block" }}>
                      📍 {cand.city} {cand.preferredUnit ? `• Unidade: ${cand.preferredUnit}` : ""}
                    </span>
                  </div>
                  <Badge variant={STATUS_VARIANTS[cand.status]}>{STATUS_LABELS[cand.status]}</Badge>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      background: "rgba(46, 207, 181, 0.12)",
                      color: "var(--color-primary-dark, #0d9488)",
                      fontSize: "12px",
                      fontWeight: "bold",
                      padding: "4px 10px",
                      borderRadius: "6px",
                    }}
                  >
                    🎯 Vaga: {ROLE_LABELS[cand.role] || cand.role}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    background: "var(--surface-sunken)",
                    padding: "10px",
                    borderRadius: "8px",
                    margin: "0 0 16px 0",
                    flex: 1,
                    lineHeight: "1.4",
                  }}
                >
                  "{cand.experienceSummary}"
                </p>

                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
                  📅 Cadastrado em: {new Date(cand.createdAt).toLocaleDateString("pt-BR")}
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "auto" }}>
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flex: 1,
                      textDecoration: "none",
                    }}
                  >
                    <Button
                      variant="primary"
                      size="sm"
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      💬 WhatsApp
                    </Button>
                  </a>
                  <Button variant="secondary" size="sm" onClick={() => handleOpenDetails(cand)} style={{ borderRadius: "8px" }}>
                    Detalhes
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Detalhes / Alterar Status */}
      {selectedCandidate && (
        <Modal onClose={() => setSelectedCandidate(null)} title={`Perfil do Candidato: ${selectedCandidate.name}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)" }}>CONTATO E LOCALIDADE</label>
              <p style={{ margin: "4px 0", fontSize: "15px", fontWeight: "bold" }}>
                📞 Telefone: {selectedCandidate.phone} | ✉️ Email: {selectedCandidate.email || "Não informado"}
              </p>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
                📍 Cidade: {selectedCandidate.city} | Unidade Desejada: {selectedCandidate.preferredUnit || "Qualquer"}
              </p>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)" }}>RESUMO DE EXPERIÊNCIA</label>
              <div style={{ padding: "12px", background: "var(--surface-sunken)", borderRadius: "8px", marginTop: "4px", fontSize: "14px" }}>
                {selectedCandidate.experienceSummary}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                ALTERAR STATUS DE RECRUTAMENTO
              </label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as CandidateStatus)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-sunken)",
                  color: "var(--text-primary)",
                  fontWeight: "bold",
                }}
              >
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                ANOTAÇÕES E FEEDBACK DA ENTREVISTA
              </label>
              <textarea
                rows={3}
                placeholder="Insira observações sobre o perfil, postura na entrevista ou combinações..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-sunken)",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px" }}>
              <Button variant="secondary" onClick={() => setSelectedCandidate(null)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleSaveDetails}>
                Salvar Alterações
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Adicionar Candidato */}
      {showAddModal && (
        <Modal onClose={() => setShowAddModal(false)} title="Cadastrar Candidato no Banco de Talentos">
          <form onSubmit={handleAddCandidate} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "8px 0" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>NOME COMPLETO *</label>
              <input
                type="text"
                required
                placeholder="Ex: Maria das Dores"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>TELEFONE / WHATSAPP *</label>
                <input
                  type="text"
                  required
                  placeholder="91999998888"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>E-MAIL</label>
                <input
                  type="email"
                  placeholder="candidato@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>VAGA ALVO</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as CandidateRole)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}
                >
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>UNIDADE PREFERENCIAL</label>
                <select
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}
                >
                  <option value="Ananindeua">Ananindeua</option>
                  <option value="Parque Shopping">Parque Shopping</option>
                  <option value="Boulevard">Boulevard</option>
                  <option value="Qualquer">Qualquer Unidade</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>RESUMO DE EXPERIÊNCIA</label>
              <textarea
                rows={3}
                placeholder="Breve resumo da experiência do candidato..."
                value={newExp}
                onChange={(e) => setNewExp(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-subtle)", fontFamily: "inherit" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px" }}>
              <Button variant="secondary" type="button" onClick={() => setShowAddModal(false)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit">
                Adicionar Candidato
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
