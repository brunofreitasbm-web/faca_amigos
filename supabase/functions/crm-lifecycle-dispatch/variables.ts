// Tipos e montagem das variáveis de template do crm-lifecycle-dispatch.
// Separado do index.ts para poder ser testado sem Deno.serve nem Supabase.

export type Kind =
  | "EXPIRACAO" | "RELATORIO_CUPOM" | "PREMIO_FIDELIDADE" | "NPS_PROMOTOR" | "NPS_DETRATOR"
  | "UPSELL_PACOTE" | "CROSS_ATIVIDADE" | "CROSS_IRMAO" | "ANIVERSARIO" | "VIP"
  | "WINBACK_1" | "WINBACK_2"
  | "DEGRAU_2H" | "DEGRAU_PORTO" | "DEGRAU_DAYUSE";

export interface Candidate {
  kind: Kind;
  category: "MARKETING" | "UTILITY";
  unit_id: string | null;
  guardian_id: string;
  guardian_name: string | null;
  phone_e164: string;
  child_first_name: string | null;
  activity: string | null;
  ref_key: string;
  extra: Record<string, unknown> | null;
}

// kind -> purpose do template. WINBACK_1/2 compartilham o mesmo template
// (purpose WINBACK); o texto muda pelo próprio conteúdo do template.
export const PURPOSE: Record<Kind, string> = {
  EXPIRACAO: "EXPIRACAO",
  RELATORIO_CUPOM: "RELATORIO_CUPOM",
  PREMIO_FIDELIDADE: "PREMIO_FIDELIDADE",
  NPS_PROMOTOR: "NPS_PROMOTOR",
  NPS_DETRATOR: "NPS_DETRATOR",
  UPSELL_PACOTE: "UPSELL_PACOTE",
  CROSS_ATIVIDADE: "CROSS_ATIVIDADE",
  CROSS_IRMAO: "CROSS_IRMAO",
  ANIVERSARIO: "ANIVERSARIO",
  VIP: "VIP",
  WINBACK_1: "WINBACK",
  WINBACK_2: "WINBACK",
  DEGRAU_2H: "DEGRAU_2H",
  DEGRAU_PORTO: "DEGRAU_PORTO",
  DEGRAU_DAYUSE: "DEGRAU_DAYUSE",
};

export const PREVIEW_LABEL: Record<Kind, string> = {
  EXPIRACAO: "aviso de saldo/validade enviado",
  RELATORIO_CUPOM: "cupom de retorno enviado",
  PREMIO_FIDELIDADE: "lembrete de prêmio enviado",
  NPS_PROMOTOR: "convite de avaliação enviado",
  NPS_DETRATOR: "aviso de contato enviado",
  UPSELL_PACOTE: "oferta de pacote enviada",
  CROSS_ATIVIDADE: "convite de outra atividade enviado",
  CROSS_IRMAO: "convite para o irmão enviado",
  ANIVERSARIO: "mensagem de aniversário enviada",
  VIP: "reconhecimento VIP enviado",
  WINBACK_1: "mensagem de saudade enviada",
  WINBACK_2: "mensagem de saudade enviada",
  DEGRAU_2H: "oferta do plano de 2 horas enviada",
  DEGRAU_PORTO: "oferta do Porto Seguro enviada",
  DEGRAU_DAYUSE: "oferta do Day Use enviada",
};

/** Atividade convidada no CROSS_ATIVIDADE: {{3}} nome, {{4}} o que se faz lá. */
const CROSS_TARGET: Record<string, { name: string; description: string }> = {
  CARRINHO: { name: "o Circuito", description: "carrinhos elétricos, motos e pelúcias motorizadas pra pilotar" },
  PLAYGROUND: { name: "o Playground", description: "brincadeira livre acompanhada de perto pela nossa equipe" },
};

/** Variáveis do template ({{1}} responsável, as demais variam por kind); null = pula. */
export function variablesFor(c: Candidate, googleReviewUrl: string): Record<string, string> | null {
  const guardian = (c.guardian_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const child = c.child_first_name || "seu filho(a)";
  const extra = c.extra ?? {};

  switch (c.kind) {
    case "EXPIRACAO": {
      const remaining = extra.remainingMinutes as number | null;
      const name = (extra.name as string | null) ?? (extra.sourceKind as string | null) ?? "seu saldo";
      const info = remaining != null && remaining <= 30 ? `restam ${remaining} min` : "está perto de vencer";
      return { "1": guardian, "2": name, "3": info };
    }
    case "RELATORIO_CUPOM":
      return { "1": guardian, "2": child, "3": "10% de desconto na próxima visita em até 14 dias" };
    case "PREMIO_FIDELIDADE":
      return { "1": guardian, "2": child };
    case "NPS_PROMOTOR":
      return { "1": guardian, "2": googleReviewUrl };
    case "NPS_DETRATOR":
      return { "1": guardian };
    case "UPSELL_PACOTE":
      return { "1": guardian, "2": child };
    case "CROSS_ATIVIDADE": {
      const target = CROSS_TARGET[(extra.targetActivity as string | null) ?? ""];
      if (!target) return null;
      return { "1": guardian, "2": child, "3": target.name, "4": target.description };
    }
    case "CROSS_IRMAO":
      return { "1": guardian, "2": child };
    case "ANIVERSARIO":
      return { "1": guardian, "2": child };
    case "VIP":
      return { "1": guardian, "2": child };
    case "WINBACK_1":
    case "WINBACK_2":
      return { "1": guardian, "2": child };
    case "DEGRAU_2H":
      return { "1": guardian, "2": child };
    case "DEGRAU_PORTO": {
      const visits = Number(extra.visits30d);
      if (!Number.isFinite(visits) || visits < 1) return null;
      return { "1": guardian, "2": child, "3": String(visits) };
    }
    case "DEGRAU_DAYUSE":
      return { "1": guardian, "2": child };
    default:
      return null;
  }
}
