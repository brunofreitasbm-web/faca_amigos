import type { Candidate, CandidateStatus, CandidateRole } from "@facaamigos/contracts";

const STORAGE_KEY = "facaamigos_banco_talentos_candidates_v1";

const INITIAL_CANDIDATES: Candidate[] = [
  {
    id: "cand-001",
    name: "Juliana Silva Santos",
    phone: "91984123456",
    email: "juliana.santos@email.com",
    city: "Ananindeua - PA",
    preferredUnit: "Ananindeua",
    role: "VENDAS",
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
    experienceSummary: "Estudante de Pedagogia, vivência com monitoria infantil e recreação em aniversários.",
    status: "ENTREVISTADO",
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
    experienceSummary: "Gestão de equipe de loja (5 colaboradores), controle de caixa, fechamento de metas e rotinas de PDV.",
    status: "BANCO_RESERVA",
    notes: "Candidato forte para futura expansão de unidade.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];

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
