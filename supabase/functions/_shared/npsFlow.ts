import {
  isDecline, NPS_FIRST_REPLY_WINDOW_MS, NPS_STEP_WINDOW_MS, NPS_TEXT, npsStep, parseNumberInRange, unitOptions,
} from "./nps.ts";
import { loadUnitOptions } from "./npsSurvey.ts";

// Só o que o fluxo usa do client do Supabase (o tipo real vem de createClient,
// sem tipagem do banco); mantém este módulo testável com um client falso.
// deno-lint-ignore no-explicit-any
export type NpsAdmin = { from(table: string): any };

/** Unidade da última visita finalizada do responsável antes do envio da pesquisa, ou null se não der para saber. */
async function visitUnitFor(admin: NpsAdmin, contactId: string, sentAtMs: number): Promise<string | null> {
  const { data: contact } = await admin.from("fa_crm_contacts").select("guardian_id").eq("id", contactId).maybeSingle();
  if (!contact?.guardian_id) return null;
  const { data: visit } = await admin
    .from("fa_kiosk_sessions")
    .select("unit_id")
    .eq("guardian_id", contact.guardian_id)
    .eq("status", "FINALIZADA")
    .lte("checkout_at_ms", sentAtMs)
    .order("checkout_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (visit?.unit_id as string | undefined) ?? null;
}

/**
 * NPS em etapas dentro do WhatsApp (regras de leitura em ./nps.ts). Devolve o
 * texto da próxima pergunta, ou null quando a mensagem não faz parte de uma
 * pesquisa em aberto (segue como conversa normal para a equipe).
 *   SENT   + nº da unidade   -> grava a unidade, pergunta 1/3 (recomendação 0-10)   [template novo]
 *   SENT   + 0..10           -> grava a nota, pergunta 2/3 (equipe)        (ASKING)
 *                               Template antigo (sem unit_options): grava a nota e pergunta
 *                               a unidade antes da equipe; ASKING + nº da unidade -> grava
 *                               a unidade e pergunta a equipe.
 *   ASKING + 1..5            -> grava a equipe, pergunta 3/3 (espaço)
 *   ASKING + 1..5            -> grava o espaço, pergunta a contribuição     (SCORED)
 *   SCORED + texto ou "não"  -> grava a contribuição e agradece             (DONE)
 * Todo UPDATE só vale se a pesquisa ainda está no estado lido: um reenvio do
 * mesmo webhook (a Twilio repete) não grava duas vezes nem pergunta de novo.
 */
export async function handleNps(admin: NpsAdmin, contactId: string, body: string, now: number): Promise<string | null> {
  const { data: survey } = await admin
    .from("fa_crm_nps_surveys")
    .select("id, status, sent_at_ms, last_step_ms, scored_at_ms, score, score_team, unit_id, unit_options")
    .eq("contact_id", contactId)
    .in("status", ["SENT", "ASKING", "SCORED"])
    .order("sent_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!survey) return null;

  // Janela: a primeira resposta vale até 7 dias do envio; as etapas seguintes, até 24h da anterior.
  const firstReply = survey.status === "SENT" && survey.last_step_ms == null;
  const since = Number(firstReply ? survey.sent_at_ms : (survey.last_step_ms ?? survey.scored_at_ms ?? survey.sent_at_ms));
  if (now - since > (firstReply ? NPS_FIRST_REPLY_WINDOW_MS : NPS_STEP_WINDOW_MS)) {
    await admin
      .from("fa_crm_nps_surveys")
      .update(survey.status === "SENT" && survey.last_step_ms == null ? { status: "EXPIRED" } : { status: "DONE", done_at_ms: now })
      .eq("id", survey.id)
      .eq("status", survey.status);
    return null;
  }

  // Aplica a mudança só se a pesquisa ainda está no estado lido (mesmo status e a coluna da
  // etapa ainda vazia); false = reenvio duplicado ou resposta concorrente.
  const advance = async (patch: Record<string, unknown>, emptyColumn?: string): Promise<boolean> => {
    let q = admin
      .from("fa_crm_nps_surveys")
      .update({ ...patch, last_step_ms: now })
      .eq("id", survey.id)
      .eq("status", survey.status);
    if (emptyColumn) q = q.is(emptyColumn, null);
    const { data } = await q.select("id");
    return (data?.length ?? 0) > 0;
  };

  switch (npsStep(survey)) {
    case "UNIT": {
      const options = unitOptions(survey.unit_options);
      const r = parseNumberInRange(body, 1, options.length);
      if (r.kind === "none") return null;
      if (r.kind === "out") return NPS_TEXT.retryUnit(options);
      // A lista confundia os responsáveis: vale a unidade da visita; a digitada só entra se a visita não for conhecida.
      const visitUnitId = await visitUnitFor(admin, contactId, Number(survey.sent_at_ms));
      const unit = options.find((o) => o.id === visitUnitId) ?? options[r.value - 1]!;
      // Antes da nota (template novo) a próxima pergunta é a nota; depois da nota (template antigo), a equipe.
      const next = survey.status === "ASKING" ? NPS_TEXT.teamQuestion : NPS_TEXT.scoreQuestion(unit.name);
      return (await advance({ unit_id: unit.id }, "unit_id")) ? next : null;
    }
    case "SCORE": {
      const r = parseNumberInRange(body, 0, 10);
      if (r.kind === "none") return null;
      if (r.kind === "out") return NPS_TEXT.retryScore;
      // Template antigo (sem pergunta de unidade): fixa a lista de unidades agora e pergunta a unidade
      // antes da equipe. Sem unidades cadastradas, segue direto para a equipe.
      const late = unitOptions(survey.unit_options).length === 0 ? await loadUnitOptions(admin) : [];
      if (late.length > 0) {
        return (await advance({ status: "ASKING", score: r.value, scored_at_ms: now, unit_options: late }, "score"))
          ? NPS_TEXT.unitAfterScoreQuestion(late)
          : null;
      }
      return (await advance({ status: "ASKING", score: r.value, scored_at_ms: now }, "score")) ? NPS_TEXT.teamQuestion : null;
    }
    case "TEAM": {
      const r = parseNumberInRange(body, 1, 5);
      if (r.kind === "none") return null;
      if (r.kind === "out") return NPS_TEXT.retryFive;
      return (await advance({ score_team: r.value }, "score_team")) ? NPS_TEXT.spaceQuestion : null;
    }
    case "SPACE": {
      const r = parseNumberInRange(body, 1, 5);
      if (r.kind === "none") return null;
      if (r.kind === "out") return NPS_TEXT.retryFive;
      // scored_at_ms passa a marcar a conclusão das notas (feed e réguas de promotor/detrator).
      return (await advance({ status: "SCORED", score_space: r.value, scored_at_ms: now }, "score_space"))
        ? NPS_TEXT.commentQuestion(Number(survey.score))
        : null;
    }
    case "COMMENT": {
      const text = body.trim();
      if (!text) return null; // só mídia: espera o texto
      if (isDecline(text)) {
        return (await advance({ status: "DONE", done_at_ms: now })) ? NPS_TEXT.thanksNoComment : null;
      }
      return (await advance({ status: "DONE", feedback: text.slice(0, 1000), done_at_ms: now })) ? NPS_TEXT.thanks : null;
    }
    default:
      return null;
  }
}
