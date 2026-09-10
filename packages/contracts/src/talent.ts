export type CandidateStatus = "NOVO" | "EM_ANALISE" | "ENTREVISTADO" | "CONTRATADO" | "BANCO_RESERVA" | "DESQUALIFICADO";

export type CandidateRole = "RECEPCAO" | "VENDAS" | "MONITORIA" | "GERENCIA" | "LIMPEZA" | "OUTRO";

export interface Candidate {
  id: string;
  name: string;
  phone: string; // E.164 or DDD + number
  email?: string;
  city: string;
  preferredUnit?: string;
  role: CandidateRole;
  roleCustom?: string;
  experienceSummary: string;
  status: CandidateStatus;
  notes?: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  resumeUrl?: string;
}

export interface CandidateFilter {
  search?: string;
  status?: CandidateStatus | "TODOS";
  role?: CandidateRole | "TODOS";
  unitId?: string;
}
