import type { Candidate, CandidateStatus, CandidateRole } from "@facaamigos/contracts";

const STORAGE_KEY = "facaamigos_banco_talentos_candidates_v1";
const API_ENDPOINT = "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/export-job-applications";

// Obtém a chave de API das variáveis de ambiente (VITE_TALENT_API_KEY ou WEBHOOK_SECRET)
const getApiKey = (): string => {
  return (import.meta as any).env?.VITE_TALENT_API_KEY || (import.meta as any).env?.VITE_WEBHOOK_SECRET || "";
};

const INITIAL_CANDIDATES: Candidate[] = [
  {
    id: "cand-001",
    name: "Juliana Silva Santos",
    phone: "91984123456",
    email: "juliana.santos@email.com",
    city: "Ananindeua - PA",
    preferredUnit: "Ananindeua",
    role: "VENDAS",
    desiredArea: "VENDAS",
    opportunityType: "REMUNERADO",
    course: "Administração",
    experienceSummary: "3 anos em vendas no varejo de shopping, atendimento ao cliente e fechamento de combos/pacotes.",
    status: "NOVO",
    notes: "Perfil altamente proativo para vendas de ingressos e combos da loja.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "cand-002",
    name: "Lucas Ferreira Lima",
    phone: "91991887766",
    email: "lucas.lima@email.com",
    city: "Belém - PA",
    preferredUnit: "Parque Shopping",
    role: "RECEPCAO",
    desiredArea: "RECEPCAO",
    opportunityType: "ESTAGIO",
    course: "Psicologia",
    experienceSummary: "Experiência com sistema de caixa, check-in de clientes e atendimento em clínica e recepção de entretenimento.",
    status: "EM_ANALISE",
    notes: "Ótima comunicação verbal. Disponibilidade imediata para turnos de shopping.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: "cand-003",
    name: "Camila Rodrigues Souza",
    phone: "91988223344",
    email: "camila.souza@email.com",
    city: "Belém - PA",
    preferredUnit: "Boulevard",
    role: "MONITORIA",
    desiredArea: "MONITORIA",
    opportunityType: "BOLSA",
    course: "Pedagogia",
    experienceSummary: "Estudante de Pedagogia, vivência com monitoria infantil e recreação em aniversários.",
    status: "ENTREVISTA",
    notes: "Entrevista realizada com aprovação da gerência. Aguardando entrega de documentos.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "cand-004",
    name: "Marcos Vinicius Costa",
    phone: "91981112233",
    city: "Ananindeua - PA",
    preferredUnit: "Ananindeua",
    role: "GERENCIA",
    desiredArea: "GERENCIA",
    opportunityType: "REMUNERADO",
    course: "Gestão Comercial",
    experienceSummary: "Gestão de equipe de loja (5 colaboradores), controle de caixa, fechamento de metas e rotinas de PDV.",
    status: "ARQUIVADO",
    notes: "Candidato forte para futura expansão de unidade.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];

function mapRole(area?: string): CandidateRole {
  if (!area) return "VENDAS";
  const upper = area.toUpperCase();
  if (upper.includes("RECEP")) return "RECEPCAO";
  if (upper.includes("MONIT")) return "MONITORIA";
  if (upper.includes("GEREN")) return "GERENCIA";
  if (upper.includes("LIMP")) return "LIMPEZA";
  if (upper.includes("VEND")) return "VENDAS";
  return "OUTRO";
}

function mapApiCandidateToLocal(item: any): Candidate {
  return {
    id: item.id || `cand-${Date.now()}`,
    name: item.full_name || item.name || "Candidato Sem Nome",
    phone: item.phone || "",
    email: item.email || "",
    city: item.city || "Pará",
    preferredUnit: item.preferred_unit || item.preferredUnit || "Ananindeua",
    role: mapRole(item.desired_area || item.role),
    desiredArea: item.desired_area || item.role || "VENDAS",
    opportunityType: item.opportunity_type || "REMUNERADO",
    course: item.course || "",
    experienceSummary: item.experience_summary || item.course ? `Formação: ${item.course}` : "Sem resumo informado",
    status: (item.status as CandidateStatus) || "NOVO",
    notes: item.notes || "",
    createdAt: item.created_at_iso || item.createdAt || new Date().toISOString(),
    updatedAt: item.updated_at_iso || item.updatedAt || new Date().toISOString(),
    createdAtMs: item.created_at_ms,
    createdAtIso: item.created_at_iso,
    resumeUrl: item.resume_url || item.resumeUrl || undefined,
  };
}

export function getStoredCandidates(): Candidate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_CANDIDATES));
      return INITIAL_CANDIDATES;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_CANDIDATES;
  }
}

export function saveStoredCandidates(candidates: Candidate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
  } catch (err) {
    console.error("Falha ao salvar banco de talentos no localStorage", err);
  }
}

export async function fetchCandidatesFromApi(statusFilter: string = "TODOS"): Promise<{ candidates: Candidate[]; isLive: boolean }> {
  const apiKey = getApiKey();
  const queryParam = statusFilter !== "TODOS" ? `?status=${encodeURIComponent(statusFilter)}&limit=100` : "?limit=100";
  const url = `${API_ENDPOINT}${queryParam}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      throw new Error(`Erro na API (${res.status}): ${res.statusText}`);
    }

    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      const remoteCandidates = data.data.map(mapApiCandidateToLocal);
      if (remoteCandidates.length > 0) {
        saveStoredCandidates(remoteCandidates);
        return { candidates: remoteCandidates, isLive: true };
      }
    }
    return { candidates: getStoredCandidates(), isLive: false };
  } catch (err) {
    console.warn("API de Talentos indisponível ou offline. Usando dados locais de fallback.", err);
    return { candidates: getStoredCandidates(), isLive: false };
  }
}

export async function updateCandidateStatusApi(id: string, newStatus: CandidateStatus, notes?: string): Promise<Candidate[]> {
  // Atualiza localmente primeiro para UX instantânea
  const updatedLocal = updateCandidateStatus(id, newStatus, notes);
  const apiKey = getApiKey();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    await fetch(API_ENDPOINT, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id, status: newStatus }),
    });
  } catch (err) {
    console.warn("Falha ao sincronizar status do candidato com o servidor remoto.", err);
  }

  return updatedLocal;
}

export function updateCandidateStatus(id: string, newStatus: CandidateStatus, notes?: string): Candidate[] {
  const list = getStoredCandidates();
  const updated = list.map((cand) => {
    if (cand.id === id) {
      return {
        ...cand,
        status: newStatus,
        notes: notes !== undefined ? notes : cand.notes,
        updatedAt: new Date().toISOString(),
      };
    }
    return cand;
  });
  saveStoredCandidates(updated);
  return updated;
}

export function addCandidate(newCand: Omit<Candidate, "id" | "createdAt" | "updatedAt" | "status">): Candidate[] {
  const list = getStoredCandidates();
  const candidate: Candidate = {
    ...newCand,
    id: `cand-${Date.now()}`,
    status: "NOVO",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const updated = [candidate, ...list];
  saveStoredCandidates(updated);
  return updated;
}

export function generateWhatsAppLink(phone: string, candidateName: string, roleTitle: string): string {
  const cleanPhone = phone.replace(/\D/g, "");
  const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
  const message = encodeURIComponent(
    `Olá, ${candidateName}! Vi seu currículo no Banco de Talentos do Faça Amigos para a vaga de ${roleTitle}. Gostaria de agendar uma conversa/entrevista conosco. Você tem disponibilidade hoje?`
  );
  return `https://wa.me/${formattedPhone}?text=${message}`;
}

