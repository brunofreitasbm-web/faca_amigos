// Envia ao responsável, por WhatsApp, o resumo do Relatório de Sessão.
//
// Chamada pela SPA logo depois de fa_session_report_submit (que já gravou o
// relatório) e pelo botão "Reenviar". O relatório NUNCA se perde por falha
// daqui: o resultado fica em fa_kiosk_session_reports.whatsapp_status.
//
// Texto: Gemini redige a mensagem (calorosa, sem linguagem clínica). Como o
// envio é automático, sem revisão humana, há duas travas: se a IA falhar OU
// usar termo clínico proibido, sai o texto determinístico montado do catálogo.
//
// Consentimento: sem fa_kiosk_guardians.whatsapp_consent_at_ms o relatório fica
// salvo e o envio é pulado (SKIPPED_NO_CONSENT) — mesma regra do NPS automático.
//
// GEMINI_API_KEY é segredo de SERVIDOR (não é o VITE_GEMINI_API_KEY do navegador).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";
import {
  findActiveChannelForUnit,
  findActiveTemplate,
  inFreeformWindow,
  sendWhatsapp,
  twilioCreds,
  upsertCrmContact,
} from "../_shared/twilioWhatsapp.ts";
import {
  SESSION_REPORT_CATALOG,
  SESSION_REPORT_LEVEL_LABEL,
  summarizeAnswersForMessage,
  type EmployeeSector,
  type SessionReportAnswers,
} from "../_shared/sessionReportCatalog.ts";

const GEMINI_MODEL = "gemini-flash-latest";
const MAX_ATTEMPTS = 5;
const MAX_MESSAGE_CHARS = 700;
// Termos que não podem chegar à família num texto sem revisão.
const FORBIDDEN = /\b(transtorno|d[eé]ficit|atraso|laudo|diagn[oó]stic\w*|sintoma\w*|TEA|TDAH|autis\w*|patolog\w*|avalia[cç][aã]o cl[ií]nica|regula[cç][aã]o emocional|processamento sensorial|planejamento motor|terap\w*)\b/i;

// Nomes das áreas para a IA: nunca o setor profissional de quem preencheu (Psicologia, Terapia Ocupacional...),
// senão a mensagem pode acabar dizendo "nossa psicóloga observou".
const GROUP_NAME: Record<EmployeeSector, string> = {
  EDUCACAO_FISICA: "Movimento",
  PSICOLOGIA: "Convivência e emoções",
  TERAPIA_OCUPACIONAL: "Autonomia e mãos",
  PEDAGOGIA: "Atenção e comunicação",
};

type Status =
  | "SENT" | "SKIPPED_NO_CONSENT" | "SKIPPED_OPT_OUT" | "SKIPPED_NO_PHONE"
  | "SKIPPED_NO_CHANNEL" | "SKIPPED_NO_TEMPLATE" | "FAILED";

const firstName = (full: string | null | undefined, fallback: string) =>
  (full ?? "").trim().split(/\s+/)[0] || fallback;

/** Parágrafo único, sem quebras/tabs (a Meta rejeita em variável de template) e com teto de tamanho. */
function sanitize(text: string): string {
  let t = text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (t.length > MAX_MESSAGE_CHARS) {
    const cut = t.slice(0, MAX_MESSAGE_CHARS);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    t = lastStop > 200 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
  }
  return t;
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;

function buildFallbackMessage(child: string, minutes: number, answers: SessionReportAnswers, observacao: string | null): string {
  const s = summarizeAnswersForMessage(answers);
  const parts = [`Hoje ${child} passou ${minutes} minutos com a gente.`];
  if (s.autonomo.length) parts.push(`Brilhou em ${list(s.autonomo.slice(0, 3).map((x) => x.toLowerCase()))}, fazendo com autonomia.`);
  const growing = [...s.desenvolvendo, ...s.apoio].slice(0, 2).map((x) => x.toLowerCase());
  if (growing.length) parts.push(`Seguimos praticando juntos, com carinho: ${list(growing)}.`);
  if (observacao) parts.push(observacao.replace(/[.!?\s]+$/, "") + ".");
  parts.push("Foi uma alegria receber vocês!");
  return sanitize(parts.join(" "));
}

function buildPrompt(child: string, minutes: number, answers: SessionReportAnswers, observacao: string | null) {
  const system = `Você é a equipe do FaçaAmigos, um playground inclusivo em Belém do Pará. Escreva uma mensagem de WhatsApp para o responsável de uma criança sobre como foi a brincadeira dela hoje.
REGRAS ABSOLUTAS:
1. Português do Brasil, tom caloroso e leve, de quem gosta da criança. Use o primeiro nome da criança.
2. Comece celebrando 2 a 3 pontos em que a criança "fez com autonomia". Depois mencione no máximo 1 ou 2 itens "em desenvolvimento" ou "com apoio" de forma positiva, como algo que estamos acompanhando juntos (ex.: "está ganhando confiança em...", "seguimos praticando juntos...").
3. Se houver observação da equipe sobre o que a criança fez, inclua como uma cena concreta.
4. PROIBIDO: linguagem clínica ou diagnóstica (regulação, processamento, planejamento motor, terapia, transtorno, déficit, atraso, laudo, diagnóstico, sintoma, TEA, TDAH), notas ou pontuações, comparação com outras crianças, promessas terapêuticas. Baseie-se SOMENTE nos dados fornecidos, sem inventar.
5. NÃO comece com "Olá" ou "Oi" e NÃO assine: a saudação e a assinatura já vêm no modelo da mensagem. No máximo 2 emojis.
6. Um único parágrafo, SEM quebras de linha, entre 400 e 600 caracteres.
Responda EXCLUSIVAMENTE em JSON: { "mensagem": "string" }`;

  const lines: string[] = [];
  for (const sec of SESSION_REPORT_CATALOG) {
    const rows = sec.items
      .filter((i) => answers[i.key] != null)
      .map((i) => `  - ${i.label}: ${SESSION_REPORT_LEVEL_LABEL[answers[i.key]!].long}`);
    if (rows.length) lines.push(`${GROUP_NAME[sec.sector]}:`, ...rows);
  }
  const prompt = `Criança: ${child}\nTempo de brincadeira: ${minutes} minutos\nO que a equipe reparou, por área:\n${lines.join("\n") || "  (nenhum item marcado)"}\nObservação livre da equipe: ${observacao ?? "(nenhuma)"}`;
  return { system, prompt };
}

async function callGemini(apiKey: string, system: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      console.error("[session-report] Gemini respondeu", res.status);
      return null;
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    const msg = (JSON.parse(raw) as { mensagem?: string }).mensagem;
    return typeof msg === "string" && msg.trim() ? msg : null;
  } catch (e) {
    console.error("[session-report] falha ao chamar Gemini", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "relatorio_sessao.write");
  if (!auth.ok) return auth.response;

  let input: { reportId?: string };
  try {
    input = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!input.reportId) return jsonResponse(req, { error: "reportId obrigatório" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: report } = await admin.from("fa_kiosk_session_reports").select("*").eq("id", input.reportId).maybeSingle();
  if (!report) return jsonResponse(req, { error: "relatório não encontrado" }, 404);

  // Só quem preencheu, ou quem pode ler todos, dispara/reenvia.
  const { data: me } = await admin.from("fa_kiosk_employees").select("id").eq("auth_user_id", auth.userId).maybeSingle();
  if (me?.id !== report.filled_by_employee_id) {
    const { data: canRead } = await auth.callerClient.rpc("fa_kiosk_can", { p_capability: "relatorio_sessao.read" });
    if (canRead !== true) return jsonResponse(req, { error: "sem permissão" }, 403);
  }

  if (report.whatsapp_status === "SENT") return jsonResponse(req, { ok: true, alreadySent: true, status: "SENT" });
  if (report.dispatch_attempts >= MAX_ATTEMPTS) {
    return jsonResponse(req, { error: "limite de tentativas de envio atingido" }, 429);
  }

  const mark = async (
    status: Status,
    extra: {
      error?: string | null; sendMode?: string | null; contactId?: string | null; messageId?: string | null;
      aiMessage?: string | null; aiFallback?: boolean | null;
    } = {},
  ) => {
    const { error } = await admin.rpc("fa_session_report_mark_dispatch", {
      p_report_id: report.id,
      p_status: status,
      p_error: extra.error ?? null,
      p_send_mode: extra.sendMode ?? null,
      p_crm_contact_id: extra.contactId ?? null,
      p_crm_message_id: extra.messageId ?? null,
      p_ai_message: extra.aiMessage ?? null,
      p_ai_model: extra.aiMessage ? (extra.aiFallback ? "fallback" : GEMINI_MODEL) : null,
      p_ai_fallback: extra.aiFallback ?? null,
    });
    if (error) console.error("[session-report] mark_dispatch falhou", error.message);
    return jsonResponse(req, { ok: status === "SENT", status, aiMessage: extra.aiMessage ?? null, sendMode: extra.sendMode ?? null, error: extra.error ?? null });
  };

  // --- Responsável, consentimento, telefone ---
  const { data: guardian } = report.guardian_id
    ? await admin.from("fa_kiosk_guardians").select("id, full_name, phone_e164, whatsapp_consent_at_ms").eq("id", report.guardian_id).maybeSingle()
    : { data: null };
  const phone = (guardian?.phone_e164 as string | undefined) ?? "";
  if (!guardian || !phone) return mark("SKIPPED_NO_PHONE");
  if (!guardian.whatsapp_consent_at_ms) return mark("SKIPPED_NO_CONSENT");

  const creds = twilioCreds();
  if (!creds) return jsonResponse(req, { error: "Twilio do CRM não configurado" }, 503);

  // --- Canal e contato ---
  const { data: sess } = await admin.from("fa_kiosk_sessions").select("activity").eq("id", report.session_id).maybeSingle();
  const channel = await findActiveChannelForUnit(admin, report.unit_id, (sess?.activity as string | undefined) ?? null);
  if (!channel) return mark("SKIPPED_NO_CHANNEL");
  const contact = await upsertCrmContact(admin, {
    channelId: channel.id, phoneE164: phone, name: guardian.full_name ?? null, guardianId: guardian.id,
  });
  if (!contact) return mark("FAILED", { error: "não foi possível criar o contato no CRM" });
  if (!contact.opt_in) return mark("SKIPPED_OPT_OUT", { contactId: contact.id });

  // --- Texto: reaproveita no reenvio; senão IA, com travas ---
  const childFirst = firstName(report.child_name_snapshot, "a criança");
  const guardianFirst = firstName(guardian.full_name, "tudo bem");
  const answers = (report.answers ?? {}) as SessionReportAnswers;
  const observacao = (report.observacao as string | null) ?? null;

  let aiMessage: string | null = (report.ai_message as string | null) ?? null;
  let aiFallback = Boolean(report.ai_fallback);
  if (!aiMessage) {
    const key = Deno.env.get("GEMINI_API_KEY");
    let generated: string | null = null;
    if (key) {
      const { system, prompt } = buildPrompt(childFirst, report.eligible_minutes, answers, observacao);
      generated = await callGemini(key, system, prompt);
    }
    const clean = generated ? sanitize(generated) : null;
    if (clean && !FORBIDDEN.test(clean)) {
      aiMessage = clean;
      aiFallback = false;
    } else {
      aiMessage = buildFallbackMessage(childFirst, report.eligible_minutes, answers, observacao);
      aiFallback = true;
    }
  }

  // --- Envio: janela aberta = texto livre; fechada = template aprovado ---
  let result;
  let sendMode: "FREEFORM" | "TEMPLATE";
  if (inFreeformWindow(contact.last_inbound_ms)) {
    sendMode = "FREEFORM";
    result = await sendWhatsapp(admin, creds, {
      channel, contact, sentByEmployeeId: report.filled_by_employee_id,
      content: { kind: "TEXT", body: sanitize(`Olá ${guardianFirst}! ${aiMessage}`) },
    });
  } else {
    const template = await findActiveTemplate(admin, "RELATORIO_SESSAO");
    if (!template) return mark("SKIPPED_NO_TEMPLATE", { contactId: contact.id, aiMessage, aiFallback });
    sendMode = "TEMPLATE";
    result = await sendWhatsapp(admin, creds, {
      channel, contact, sentByEmployeeId: report.filled_by_employee_id,
      content: { kind: "TEMPLATE", template, variables: { "1": guardianFirst, "2": childFirst, "3": aiMessage } },
    });
  }

  if (!result.ok) return mark("FAILED", { error: result.error, sendMode, contactId: contact.id, aiMessage, aiFallback });
  return mark("SENT", { sendMode, contactId: contact.id, messageId: result.messageId, aiMessage, aiFallback });
});
