import { useEffect, useState } from "react";
import { Card, Button, Badge } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { JobApplication } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";

const OPPORTUNITY_LABEL: Record<JobApplication["opportunity_type"], string> = {
  ESTAGIO: "Estágio",
  REMUNERADO: "Vaga remunerada",
  BOLSA: "Bolsa",
};

const STATUS_LABEL: Record<JobApplication["status"], string> = {
  NOVO: "Novo",
  LIDO: "Lido",
  ESPERA: "Em espera",
  ENTREVISTA: "Agendar entrevista",
  EM_ANALISE: "Em análise",
  CONTATADO: "Contatado",
  ARQUIVADO: "Arquivado",
};

const STATUS_BADGE_VARIANT: Record<JobApplication["status"], "teal" | "amber" | "neutral"> = {
  NOVO: "teal",
  LIDO: "teal",
  ESPERA: "amber",
  ENTREVISTA: "teal",
  EM_ANALISE: "amber",
  CONTATADO: "teal",
  ARQUIVADO: "neutral",
};

const STATUS_OPTIONS: JobApplication["status"][] = [
  "NOVO",
  "LIDO",
  "ESPERA",
  "ENTREVISTA",
  "EM_ANALISE",
  "CONTATADO",
  "ARQUIVADO",
];

/**
 * Banco de Talentos — candidaturas recebidas pelo formulário "Venha Fazer
 * Parte do Nosso Time" da landing page (Edge Function
 * job-application-webhook), triadas aqui pelo RH (Owner).
 */
export function BancoTalentosTab() {
  const toast = useToast();
  const [items, setItems] = useState<JobApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<JobApplication["status"] | "TODOS">("TODOS");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Api.jobApplications()
      .then(setItems)
      .catch(() => toast.error("Não foi possível carregar as candidaturas."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleOpenResume(item: JobApplication) {
    try {
      const url = await Api.jobApplicationResumeUrl(item.resume_path);
      window.open(url, "_blank");
    } catch {
      toast.error("Não foi possível abrir o currículo.");
    }
  }

  async function handleStatusChange(item: JobApplication, status: JobApplication["status"]) {
    setBusyId(item.id);
    try {
      await Api.updateJobApplicationStatus(item.id, status);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
      toast.success(`Status atualizado para '${STATUS_LABEL[status]}'.`);
    } catch {
      toast.error("Não foi possível atualizar o status.");
    } finally {
      setBusyId(null);
    }
  }

  const visibleItems = statusFilter === "TODOS" ? items : items.filter((i) => i.status === statusFilter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-secondary)" }}>Filtrar por Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JobApplication["status"] | "TODOS")}
            style={{
              padding: "8px 16px",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            <option value="TODOS">Todos os Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Carregando candidaturas…</p>}

      {!loading && visibleItems.length === 0 && (
        <Card style={{ padding: "24px", borderRadius: "16px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>Nenhuma candidatura encontrada.</p>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
        {visibleItems.map((item) => (
          <Card key={item.id} style={{ padding: "20px", borderRadius: "16px", border: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div>
                <h3 style={{ fontSize: "18px", margin: "0 0 4px 0", color: "var(--text-primary)" }}>{item.full_name}</h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                  {item.desired_area} · {OPPORTUNITY_LABEL[item.opportunity_type]}
                </p>
              </div>
              <Badge variant={STATUS_BADGE_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            </div>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 4px 0" }}>📧 {item.email}</p>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 4px 0" }}>📱 {item.phone}</p>
            {item.course && (
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 12px 0" }}>🎓 {item.course}</p>
            )}

            {/* Checkboxes de Status Rápido */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: "var(--surface-sunken)", borderRadius: "10px", margin: "10px 0" }}>
              <label style={{ fontSize: "12px", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "4px", cursor: busyId === item.id ? "wait" : "pointer", opacity: busyId === item.id ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  disabled={busyId === item.id}
                  checked={item.status === "LIDO"}
                  onChange={() => handleStatusChange(item, item.status === "LIDO" ? "NOVO" : "LIDO")}
                />
                Lido
              </label>
              <label style={{ fontSize: "12px", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "4px", cursor: busyId === item.id ? "wait" : "pointer", opacity: busyId === item.id ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  disabled={busyId === item.id}
                  checked={item.status === "ESPERA"}
                  onChange={() => handleStatusChange(item, item.status === "ESPERA" ? "NOVO" : "ESPERA")}
                />
                Espera
              </label>
              <label style={{ fontSize: "12px", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "4px", cursor: busyId === item.id ? "wait" : "pointer", opacity: busyId === item.id ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  disabled={busyId === item.id}
                  checked={item.status === "ENTREVISTA"}
                  onChange={() => handleStatusChange(item, item.status === "ENTREVISTA" ? "NOVO" : "ENTREVISTA")}
                />
                Agendar entrevista
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              <Button variant="secondary" size="sm" onClick={() => handleOpenResume(item)}>
                📄 Ver currículo
              </Button>
              <select
                value={item.status}
                disabled={busyId === item.id}
                onChange={(e) => handleStatusChange(item, e.target.value as JobApplication["status"])}
                style={{
                  padding: "6px 12px",
                  borderRadius: "9999px",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-card)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
