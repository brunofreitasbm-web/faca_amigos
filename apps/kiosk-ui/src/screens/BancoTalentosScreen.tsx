import { useEffect, useState } from "react";
import { Card, Button, Badge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { JobApplication } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";

const OPPORTUNITY_LABEL: Record<JobApplication["opportunity_type"], string> = {
  ESTAGIO: "Estágio",
  REMUNERADO: "Vaga remunerada",
  BOLSA: "Bolsa",
};

const STATUS_LABEL: Record<JobApplication["status"], string> = {
  NOVO: "Novo",
  EM_ANALISE: "Em análise",
  CONTATADO: "Contatado",
  ARQUIVADO: "Arquivado",
};

const STATUS_BADGE_VARIANT: Record<JobApplication["status"], "teal" | "amber" | "neutral"> = {
  NOVO: "teal",
  EM_ANALISE: "amber",
  CONTATADO: "teal",
  ARQUIVADO: "neutral",
};

const STATUS_OPTIONS: JobApplication["status"][] = ["NOVO", "EM_ANALISE", "CONTATADO", "ARQUIVADO"];

/**
 * Banco de Talentos — candidaturas recebidas pelo formulário "Venha Fazer
 * Parte do Nosso Time" da landing page (Edge Function
 * job-application-webhook), triadas aqui pelo RH (Líder/Owner).
 *
 * O currículo fica num bucket privado (`curriculos`): o link de download é
 * gerado sob demanda no clique via signed URL de 60s (Api.jobApplicationResumeUrl),
 * nunca guardado em cache — o mesmo motivo do bucket não ter getPublicUrl.
 */
export function BancoTalentosScreen() {
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
    } catch {
      toast.error("Não foi possível atualizar o status.");
    } finally {
      setBusyId(null);
    }
  }

  const visibleItems = statusFilter === "TODOS" ? items : items.filter((i) => i.status === statusFilter);

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
            🌟 Banco de Talentos
          </h1>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "14px" }}>
            Candidaturas recebidas pelo site — analise o currículo e atualize o status conforme a triagem avança.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-secondary)" }}>Status:</span>
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
            <option value="TODOS">Todos</option>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
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
