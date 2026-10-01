import { supabase } from "../lib/supabase/client.js";

/**
 * Chamadas da tela pública `?nps=<token>` (NPS por clique). Usa a chave anon
 * e só as RPCs `fa_crm_nps_web_*` (migration 20261001140000): o token é o
 * segredo, não há leitura nem escrita direta em tabela.
 */
export type NpsWebInfo =
  | { state: "OPEN"; brand: string; firstName: string | null }
  | { state: "ALREADY_ANSWERED" | "EXPIRED"; brand: string }
  | { state: "NOT_FOUND" };

export interface NpsWebAnswer {
  score: number;
  scoreTeam: number;
  scoreSpace: number;
  feedback: string;
}

export async function fetchNpsWeb(token: string): Promise<NpsWebInfo> {
  const { data, error } = await supabase().rpc("fa_crm_nps_web_get", { p_token: token });
  if (error) throw new Error(error.message);
  return data as NpsWebInfo;
}

export async function submitNpsWeb(token: string, a: NpsWebAnswer): Promise<void> {
  const { error } = await supabase().rpc("fa_crm_nps_web_submit", {
    p_token: token,
    p_score: a.score,
    p_score_team: a.scoreTeam,
    p_score_space: a.scoreSpace,
    p_feedback: a.feedback.trim() || null,
  });
  if (error) throw new Error(error.message);
}
