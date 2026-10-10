// Gera o "Olhar FaçaAmigos" (PDF com a marca) e envia ao responsável, por
// WhatsApp, um link que abre o documento.
//
// Chamada pela SPA logo depois de fa_session_report_submit (que já gravou o
// relatório) e pelos botões "Reenviar"/"Regerar" do Gerencial. O relatório
// NUNCA se perde por falha daqui: o resultado fica em
// fa_kiosk_session_reports.whatsapp_status.
//
// Texto: Gemini devolve UM JSON (título, abertura, prosa por área, fechamento
// e um destaque curto para o WhatsApp). Como o envio é automático, sem revisão
// humana, há duas travas: se a IA falhar, vier fora do formato OU usar termo
// proibido em qualquer campo, o documento INTEIRO sai do gerador
// determinístico (ai_fallback=true). Os itens observados e os níveis do PDF
// vêm do catálogo, nunca da IA. A nota de blindagem é fixa.
//
// PDF: _shared/sessionReportPdf.ts -> bucket privado relatorios-sessao ->
// token público de 256 bits (gravado uma vez; Reenviar/Regerar mantêm o link).
// Link: /functions/v1/session-report-view?t=<token>.
//
// Consentimento: sem fa_kiosk_guardians.whatsapp_consent_at_ms o PDF é gerado
// (o Gerencial consegue abrir) mas o envio é pulado (SKIPPED_NO_CONSENT).
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
  SESSION_REPORT_GROUP_KEY,
  SESSION_REPORT_GROUP_NAME,
  summarizeAnswersBySector,
  summarizeAnswersForMessage,
  type SectorSummary,
  type SessionReportAnswers,
  type SessionReportLevel,
} from "../_shared/sessionReportCatalog.ts";
import {
  buildOlharTrail,
  nextOlharMilestone,
  olharEdition,
  olharOrdinal,
  type OlharTrail,
  type OlharTrailHistoryItem,
} from "../_shared/sessionReportTrail.ts";
import { buildSessionReportPdf, stripForPdf, type SessionReportDoc } from "../_shared/sessionReportPdf.ts";

const GEMINI_MODEL = "gemini-flash-latest";
const MAX_ATTEMPTS = 5;
const MAX_HIGHLIGHT_CHARS = 200;
const BUCKET = "relatorios-sessao";

// Termos que não podem chegar à família num texto sem revisão. Inclui o
// vocabulário de "sessão/atendimento": o documento é um registro da
// brincadeira, e a nota de blindagem só faz sentido se o corpo não contradiz.
const FORBIDDEN =
  /\b(transtorno|d[eé]ficit|atraso|laudo|diagn[oó]stic\w*|sintoma\w*|TEA|TDAH|autis\w*|patolog\w*|avalia[cç]\w*|regula[cç][aã]o emocional|processamento sensorial|planejamento motor|terap\w*|sess[aã]o|sess[oõ]es|atendimento\w*|evolu[cç][aã]o|progress\w*|regred\w*|regress\w*|piorou|melhorou|desempenho|notas?|pontua[cç]\w*|interven[cç][aã]o|desenvolvimento|habilidade\w*|estimula[cç][aã]o|paciente\w*|tratamento\w*|cl[ií]nic\w*)\b/i;

// Como cada nível chega à IA — nunca o rótulo "técnico" do catálogo.
const LEVEL_FOR_AI: Record<SessionReportLevel, string> = {
  AUTONOMO: "fez sozinho(a)",
  DESENVOLVENDO: "está praticando",
  APOIO: "precisou de uma ajudinha",
};

type Status =
  | "SENT" | "SKIPPED_NO_CONSENT" | "SKIPPED_OPT_OUT" | "SKIPPED_NO_PHONE"
  | "SKIPPED_NO_CHANNEL" | "SKIPPED_NO_TEMPLATE" | "FAILED";

/** Primeiro nome em caixa normal ("LIZ" -> "Liz", "ana maria" -> "Ana"): os cadastros vêm em maiúsculas. */
const firstName = (full: string | null | undefined, fallback: string) => {
  const w = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!w) return fallback;
  return w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR");
};

/** Uma linha, sem quebras/tabs (a Meta rejeita em variável de template) e com teto. */
function oneLine(text: string, max: number): string {
  let t = text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    t = lastStop > max * 0.4 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
  }
  return t;
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
const lower = (items: string[]) => items.map((x) => x.charAt(0).toLowerCase() + x.slice(1));

/** Prosa de uma área, só do catálogo: celebra o autônomo, depois o que seguimos praticando. */
function areaProse(child: string, s: SectorSummary): string {
  const parts: string[] = [];
  if (s.autonomo.length) parts.push(`${child} brilhou em ${list(lower(s.autonomo))}, fazendo tudo sozinho(a).`);
  if (s.desenvolvendo.length) parts.push(`Seguimos praticando juntos, no ritmo de ${child}: ${list(lower(s.desenvolvendo))}.`);
  if (s.apoio.length) parts.push(`Com uma ajudinha carinhosa da equipe, ${child} também experimentou ${list(lower(s.apoio))}.`);
  return parts.join(" ");
}

/** Documento determinístico, montado só do catálogo e da trilha. Sai quando a IA falha ou usa termo proibido. */
function buildFallbackDoc(child: string, minutes: number, answers: SessionReportAnswers, observacao: string | null, trail: OlharTrail): SessionReportDoc {
  const areas: SessionReportDoc["areas"] = {};
  for (const s of summarizeAnswersBySector(answers)) {
    if (trail.edition !== "ESTREIA" && s.sector !== trail.spotlight) continue;
    areas[SESSION_REPORT_GROUP_KEY[s.sector]] = areaProse(child, s);
  }
  const all = summarizeAnswersForMessage(answers);
  const obs = observacao ? ` ${observacao.replace(/[.!?\s]+$/, "")}.` : "";
  const highlight = all.autonomo.length
    ? `${child} brilhou em ${lower(all.autonomo.slice(0, 2)).join(" e ")}, fazendo sozinho(a)!`
    : `${child} brincou por ${minutes} minutos com a gente e explorou o espaço do seu jeito!`;
  if (trail.edition === "ESTREIA") {
    return {
      titulo: `O dia de ${child} no FaçaAmigos`,
      abertura: `Hoje ${child} passou ${minutes} minutos brincando com a gente. Aqui está um pouco do que a nossa equipe de recreação viu enquanto ${child} brincava, corria e fazia amigos.${obs}`,
      areas,
      fechamento: `Foi uma alegria receber vocês! Cada visita é um dia diferente, e a gente adora ver ${child} brincando do seu jeito. Estamos esperando a próxima brincadeira.`,
      destaque_whatsapp: oneLine(highlight, MAX_HIGHLIGHT_CHARS),
    };
  }
  const ord = olharOrdinal(trail.seq);
  const { primeiraVez, primeiraAutonomia } = trail.novidades;
  const novParts: string[] = [];
  if (primeiraVez.length) novParts.push(`Hoje apareceram brincadeiras novas por aqui: ${list(lower(primeiraVez))}.`);
  if (primeiraAutonomia.length) novParts.push(`E ${child} fez sozinho(a): ${list(lower(primeiraAutonomia))}.`);
  const doc: SessionReportDoc = {
    titulo: `O ${ord} Olhar de ${child}`,
    abertura: `Que bom ter ${child} de volta! Este é o ${ord} Olhar, e hoje ${child} brincou por ${minutes} minutos com a gente. Cada visita traz um jeito novo de brincar.${obs}`,
    areas,
    fechamento: `Obrigado por trazer ${child} de novo! A cada visita a gente descobre mais um jeito de brincar junto. Estamos esperando a próxima.`,
    destaque_whatsapp: oneLine(highlight, MAX_HIGHLIGHT_CHARS),
  };
  if (novParts.length) doc.novidades = novParts.join(" ");
  if (trail.edition === "MARCO") {
    doc.retrospectiva = `Em ${trail.visitas.length} visitas, ${child} já brincou ${trail.totalMinutos} minutos com a gente e explorou ${trail.itensExplorados} de ${trail.totalItens} brincadeiras do nosso caminho. A cada visita, um jeito novo de brincar!`;
  }
  return doc;
}

function keysSpec(trail: OlharTrail): string {
  const titulo = `   "titulo": string até 60 caracteres, alegre, com o nome da criança;`;
  const fim = `   "fechamento": 1 parágrafo de 150 a 300 caracteres, convidando a voltar;
   "destaque_whatsapp": 1 ou 2 frases, até 200 caracteres, uma cena concreta e alegre do dia.`;
  if (trail.edition === "ESTREIA") {
    return `${titulo}
   "abertura": 1 parágrafo de 250 a 450 caracteres;
   "areas": objeto com as chaves movimento, convivencia, autonomia, atencao — SÓ as áreas listadas nos dados —, cada uma 1 parágrafo de 200 a 400 caracteres;
${fim}`;
  }
  const hasNov = trail.novidades.primeiraVez.length + trail.novidades.primeiraAutonomia.length > 0;
  return `${titulo}
   "abertura": 1 parágrafo de 250 a 450 caracteres, que reconheça que a criança voltou e que este é o ${olharOrdinal(trail.seq)} Olhar (não repita o que se diria no primeiro);
   "areas": objeto SÓ com a chave da área em destaque listada nos dados, 1 parágrafo de 300 a 550 caracteres, mais aprofundado, com uma cena concreta;${
     hasNov ? `\n   "novidades": 1 parágrafo de 100 a 350 caracteres sobre o que apareceu de novo hoje (use SOMENTE a lista de novidades dos dados);` : ""
   }${
     trail.edition === "MARCO"
       ? `\n   "retrospectiva": 1 parágrafo de 300 a 600 caracteres celebrando o caminho de brincadeiras até aqui, usando só os números dos dados; celebre o caminho, não compare com outras crianças nem com um "antes ruim";`
       : ""
   }
${fim}`;
}

function buildPrompt(child: string, minutes: number, answers: SessionReportAnswers, observacao: string | null, trail: OlharTrail) {
  const system = `Você é a equipe de recreação do FaçaAmigos, um playground inclusivo em Belém do Pará. Escreva, para o responsável, o "Olhar FaçaAmigos": um texto sobre como foi a BRINCADEIRA da criança hoje, do jeito que a equipe viu.
REGRAS ABSOLUTAS:
1. Português do Brasil, tom caloroso, leve e concreto, de quem gosta da criança. Use o primeiro nome da criança. Descreva o que ela FEZ enquanto brincava — nunca o que ela "é" ou "tem".
2. Em cada área que você escrever, celebre primeiro o que a criança fez sozinha; depois cite no máximo 1 item que "está praticando" ou que "precisou de uma ajudinha", sempre como algo que seguimos fazendo juntos (ex.: "está ganhando confiança em...", "seguimos praticando juntos..."). Só use as áreas que receberam itens.
3. Se houver observação da equipe, transforme numa cena concreta na abertura ou na área que combina.
4. PROIBIDO, em qualquer campo: progresso, melhora, piora, regressão, desempenho, nota, pontuação; qualquer palavra de sessão, atendimento, terapia, avaliação, evolução, desenvolvimento, habilidade, estimulação, intervenção, clínica, diagnóstico, laudo, transtorno, déficit, atraso, sintoma, TEA, TDAH, autismo, paciente, tratamento; notas, pontuações ou comparação com outras crianças; promessas de resultado. Baseie-se SOMENTE nos dados fornecidos, sem inventar.
5. PROIBIDO emojis (o documento é impresso). NÃO comece com "Olá"/"Oi" e NÃO assine.
6. Responda EXCLUSIVAMENTE em JSON com estas chaves:
${keysSpec(trail)}`;

  const lines: string[] = [];
  for (const s of summarizeAnswersBySector(answers)) {
    if (trail.edition !== "ESTREIA" && s.sector !== trail.spotlight) continue;
    lines.push(`${SESSION_REPORT_GROUP_NAME[s.sector]} (chave "${SESSION_REPORT_GROUP_KEY[s.sector]}"):`);
    for (const l of s.autonomo) lines.push(`  - ${l}: ${LEVEL_FOR_AI.AUTONOMO}`);
    for (const l of s.desenvolvendo) lines.push(`  - ${l}: ${LEVEL_FOR_AI.DESENVOLVENDO}`);
    for (const l of s.apoio) lines.push(`  - ${l}: ${LEVEL_FOR_AI.APOIO}`);
  }
  const extra: string[] = [];
  if (trail.edition !== "ESTREIA") {
    extra.push(`Este é o ${olharOrdinal(trail.seq)} Olhar da criança (${trail.visitas.length} visitas até aqui).`);
    extra.push(`Novidades de hoje — apareceram pela primeira vez: ${trail.novidades.primeiraVez.join("; ") || "(nenhuma)"}`);
    extra.push(`Novidades de hoje — fez sozinho(a) pela primeira vez: ${trail.novidades.primeiraAutonomia.join("; ") || "(nenhuma)"}`);
  }
  if (trail.edition === "MARCO") {
    extra.push(`Totais do caminho: ${trail.visitas.length} visitas, ${trail.totalMinutos} minutos de brincadeira, ${trail.itensExplorados} de ${trail.totalItens} brincadeiras já exploradas.`);
    const top = Object.entries(trail.conquistasPorArea).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) extra.push(`Área com mais momentos de autonomia vistos: ${SESSION_REPORT_GROUP_NAME[top[0] as keyof typeof SESSION_REPORT_GROUP_NAME]} (${top[1]} momentos).`);
  }
  const heading = trail.edition === "ESTREIA" ? "O que a equipe reparou, por área" : "Área em destaque hoje";
  const prompt = `Criança: ${child}\nTempo de brincadeira: ${minutes} minutos\n${extra.length ? extra.join("\n") + "\n" : ""}${heading}:\n${lines.join("\n") || "  (nenhum item marcado)"}\nObservação livre da equipe: ${observacao ?? "(nenhuma)"}`;
  return { system, prompt };
}

// O alias "-latest" devolve 503 quando o modelo está sobrecarregado; os
// seguintes são ids concretos que servem de reserva antes do fallback local.
const GEMINI_MODELS = [GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.0-flash"];

/** Uma chamada ao Gemini por modelo; em 5xx/429 (instabilidade) passa ao próximo antes de ceder ao fallback. */
async function callGemini(apiKey: string, system: string, prompt: string): Promise<{ raw: unknown; model: string } | null> {
  for (let attempt = 1; attempt <= GEMINI_MODELS.length; attempt++) {
    const model = GEMINI_MODELS[attempt - 1]!;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
      if (res.ok) {
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return raw ? { raw: JSON.parse(raw), model } : null;
      }
      console.error(`[session-report] Gemini ${model} respondeu ${res.status} (tentativa ${attempt})`);
      if (res.status < 500 && res.status !== 429 && res.status !== 404) return null;
    } catch (e) {
      console.error("[session-report] falha ao chamar Gemini", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

const AREA_KEYS = ["movimento", "convivencia", "autonomia", "atencao"] as const;

/** Valida o formato e a ausência de termos proibidos em TODOS os campos; null = usar fallback. */
function validateDoc(raw: unknown, allowedAreas: Set<string>, trail: OlharTrail): SessionReportDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, min: number, max: number) =>
    typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? stripForPdf(v) : null;
  const titulo = str(r.titulo, 4, 90);
  const abertura = str(r.abertura, 120, 700);
  const fechamento = str(r.fechamento, 60, 500);
  const destaque = str(r.destaque_whatsapp, 20, 260);
  if (!titulo || !abertura || !fechamento || !destaque) return null;
  const areas: SessionReportDoc["areas"] = {};
  const rawAreas = (r.areas && typeof r.areas === "object" ? r.areas : {}) as Record<string, unknown>;
  for (const k of AREA_KEYS) {
    if (!allowedAreas.has(k)) continue;
    const v = str(rawAreas[k], 80, 800);
    if (!v) return null; // área com itens precisa de prosa
    areas[k] = v;
  }
  const doc: SessionReportDoc = { titulo, abertura, areas, fechamento, destaque_whatsapp: oneLine(destaque, MAX_HIGHLIGHT_CHARS) };
  if (trail.edition !== "ESTREIA" && trail.novidades.primeiraVez.length + trail.novidades.primeiraAutonomia.length > 0) {
    const nov = str(r.novidades, 40, 500);
    if (!nov) return null;
    doc.novidades = nov;
  }
  if (trail.edition === "MARCO") {
    const retro = str(r.retrospectiva, 150, 800);
    if (!retro) return null;
    doc.retrospectiva = retro;
  }
  const everything = [doc.titulo, doc.abertura, doc.fechamento, doc.destaque_whatsapp, doc.novidades ?? "", doc.retrospectiva ?? "", ...Object.values(doc.areas)].join("\n");
  if (FORBIDDEN.test(everything)) {
    console.warn("[session-report] IA usou termo proibido; usando fallback");
    return null;
  }
  return doc;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const dateLabel = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "relatorio_sessao.write");
  if (!auth.ok) return auth.response;

  let input: { reportId?: string; regenerate?: boolean };
  try {
    input = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!input.reportId) return jsonResponse(req, { error: "reportId obrigatório" }, 400);
  const regenerate = input.regenerate === true;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: report } = await admin.from("fa_kiosk_session_reports").select("*").eq("id", input.reportId).maybeSingle();
  if (!report) return jsonResponse(req, { error: "relatório não encontrado" }, 404);

  // Só quem preencheu, ou quem pode ler todos, dispara/reenvia.
  const { data: me } = await admin.from("fa_kiosk_employees").select("id").eq("auth_user_id", auth.userId).maybeSingle();
  if (me?.id !== report.filled_by_employee_id) {
    const { data: canRead } = await auth.callerClient.rpc("fa_kiosk_can", { p_capability: "relatorio_sessao.read" });
    if (canRead !== true) return jsonResponse(req, { error: "sem permissão" }, 403);
  }

  if (report.whatsapp_status === "SENT" && !regenerate) return jsonResponse(req, { ok: true, alreadySent: true, status: "SENT" });
  // O teto vale para reenvios automáticos/repetidos; "Regerar" é ação deliberada do Gerencial.
  if (report.dispatch_attempts >= MAX_ATTEMPTS && !regenerate) {
    return jsonResponse(req, { error: "limite de tentativas de envio atingido" }, 429);
  }

  let aiModel: string = GEMINI_MODEL; // preenchido abaixo com o modelo que respondeu
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
      p_ai_model: extra.aiMessage ? (extra.aiFallback ? "fallback" : aiModel) : null,
      p_ai_fallback: extra.aiFallback ?? null,
    });
    if (error) console.error("[session-report] mark_dispatch falhou", error.message);
    return jsonResponse(req, { ok: status === "SENT", status, aiMessage: extra.aiMessage ?? null, sendMode: extra.sendMode ?? null, error: extra.error ?? null });
  };

  // --- Texto: reaproveita no reenvio; senão IA, com travas ---
  const childFirst = firstName(report.child_name_snapshot, "a criança");
  const answers = (report.answers ?? {}) as SessionReportAnswers;
  const observacao = (report.observacao as string | null) ?? null;
  const minutes = Number(report.eligible_minutes ?? 0);

  // --- Trilha: posição da criança na sequência de Olhares (define o formato) ---
  const { data: histRows, error: histErr } = await admin
    .from("fa_kiosk_session_reports")
    .select("id, filled_at_ms, eligible_minutes, answers")
    .eq("child_id", report.child_id)
    .lte("filled_at_ms", report.filled_at_ms)
    .order("filled_at_ms", { ascending: true })
    .order("id", { ascending: true });
  if (histErr) console.error("[session-report] histórico da trilha falhou", histErr.message);
  const history: OlharTrailHistoryItem[] = (histRows ?? []).map((h) => ({
    id: h.id as string,
    filledAtMs: Number(h.filled_at_ms),
    eligibleMinutes: Number(h.eligible_minutes ?? 0),
    answers: (h.answers ?? {}) as SessionReportAnswers,
  }));
  let trail = buildOlharTrail(history, report.id as string);
  // O nº gravado na 1ª geração manda: regerar não renumera a trilha.
  const savedSeq = Number(report.olhar_seq ?? 0);
  if (savedSeq > 0 && savedSeq !== trail.seq) {
    trail = { ...trail, seq: savedSeq, edition: olharEdition(savedSeq), nextMilestone: nextOlharMilestone(savedSeq) };
  }

  let doc: SessionReportDoc | null = !regenerate && report.ai_report ? (report.ai_report as SessionReportDoc) : null;
  let aiFallback = Boolean(report.ai_fallback);
  aiModel = (report.ai_model as string | null) ?? GEMINI_MODEL;
  if (!doc) {
    const key = Deno.env.get("GEMINI_API_KEY");
    let generated: SessionReportDoc | null = null;
    if (key) {
      const { system, prompt } = buildPrompt(childFirst, minutes, answers, observacao, trail);
      const allowed = new Set(
        summarizeAnswersBySector(answers)
          .filter((s) => trail.edition === "ESTREIA" || s.sector === trail.spotlight)
          .map((s) => SESSION_REPORT_GROUP_KEY[s.sector]),
      );
      const answer = await callGemini(key, system, prompt);
      generated = answer ? validateDoc(answer.raw, allowed, trail) : null;
      if (answer) aiModel = answer.model;
    }
    if (generated) {
      doc = generated;
      aiFallback = false;
    } else {
      doc = buildFallbackDoc(childFirst, minutes, answers, observacao, trail);
      aiFallback = true;
    }
  }
  const highlight = oneLine(doc.destaque_whatsapp, MAX_HIGHLIGHT_CHARS);

  // --- PDF: reaproveita no reenvio; regenera quando pedido ou quando não existe ---
  let token: string | null = (report.public_token as string | null) ?? null;
  if (regenerate || !report.pdf_path || !report.ai_report) {
    const { data: unit } = await admin.from("fa_kiosk_units").select("name").eq("id", report.unit_id).maybeSingle();
    const t0 = performance.now();
    let bytes: Uint8Array;
    try {
      bytes = await buildSessionReportPdf({
        childFirst,
        dateLabel: dateLabel(Number(report.session_checkout_at_ms)),
        minutes,
        unitLabel: (unit?.name as string | undefined) ?? "FaçaAmigos",
        answers,
        observacao,
        report: doc,
        trail,
      });
    } catch (e) {
      console.error("[session-report] falha ao gerar PDF", e instanceof Error ? e.message : e);
      return mark("FAILED", { error: "falha ao gerar o PDF", aiMessage: highlight, aiFallback });
    }
    console.log(`[session-report] PDF ${bytes.byteLength} bytes em ${Math.round(performance.now() - t0)} ms`);

    const path = `${report.unit_id}/${report.id}.pdf`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true, cacheControl: "0" });
    if (upErr) {
      console.error("[session-report] upload falhou", upErr.message);
      return mark("FAILED", { error: "falha ao guardar o PDF", aiMessage: highlight, aiFallback });
    }
    const { data: savedToken, error: setErr } = await admin.rpc("fa_session_report_set_pdf", {
      p_report_id: report.id, p_pdf_path: path, p_public_token: token ?? newToken(), p_ai_report: doc,
      p_olhar_seq: trail.seq, p_olhar_edition: trail.edition,
    });
    if (setErr) {
      console.error("[session-report] set_pdf falhou", setErr.message);
      return mark("FAILED", { error: "falha ao registrar o PDF", aiMessage: highlight, aiFallback });
    }
    token = savedToken as string;
  }
  const link = `${Deno.env.get("SUPABASE_URL")}/functions/v1/session-report-view?t=${token}`;

  // --- Responsável, consentimento, telefone ---
  const { data: guardian } = report.guardian_id
    ? await admin.from("fa_kiosk_guardians").select("id, full_name, phone_e164, whatsapp_consent_at_ms").eq("id", report.guardian_id).maybeSingle()
    : { data: null };
  const phone = (guardian?.phone_e164 as string | undefined) ?? "";
  // Celular/fixo BR em E.164 (+55 DDD 8-9 dígitos). Dado corrompido (ex.: dois números colados) não vai à Twilio nem vira contato no CRM.
  if (!guardian || !/^\+55[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(phone)) {
    return mark("SKIPPED_NO_PHONE", { aiMessage: highlight, aiFallback });
  }
  if (!guardian.whatsapp_consent_at_ms) return mark("SKIPPED_NO_CONSENT", { aiMessage: highlight, aiFallback });

  const creds = twilioCreds();
  if (!creds) return jsonResponse(req, { error: "Twilio do CRM não configurado" }, 503);

  // --- Canal e contato ---
  const { data: sess } = await admin.from("fa_kiosk_sessions").select("activity").eq("id", report.session_id).maybeSingle();
  const channel = await findActiveChannelForUnit(admin, report.unit_id, (sess?.activity as string | undefined) ?? null);
  if (!channel) return mark("SKIPPED_NO_CHANNEL", { aiMessage: highlight, aiFallback });
  const contact = await upsertCrmContact(admin, {
    channelId: channel.id, phoneE164: phone, name: guardian.full_name ?? null, guardianId: guardian.id,
  });
  if (!contact) return mark("FAILED", { error: "não foi possível criar o contato no CRM", aiMessage: highlight, aiFallback });
  if (!contact.opt_in) return mark("SKIPPED_OPT_OUT", { contactId: contact.id, aiMessage: highlight, aiFallback });

  const guardianFirst = firstName(guardian.full_name, "tudo bem");

  // --- Envio: janela aberta = texto livre; fechada = template com botão; senão o de texto ---
  let result;
  let sendMode: "FREEFORM" | "TEMPLATE";
  const common = { channel, contact, sentByEmployeeId: report.filled_by_employee_id as string };
  if (inFreeformWindow(contact.last_inbound_ms)) {
    sendMode = "FREEFORM";
    const body =
      `Olá ${guardianFirst}! ${highlight}\n\n${
        trail.edition === "ESTREIA"
          ? `O Olhar FaçaAmigos de hoje sobre ${childFirst}`
          : `O ${olharOrdinal(trail.seq)} Olhar FaçaAmigos de ${childFirst}${trail.edition === "MARCO" ? ", com a retrospectiva das brincadeiras," : ""}`
      }, com o que a nossa equipe viu enquanto ${childFirst} brincava, está aqui: ${link}\n\n` +
      `É um registro observacional da brincadeira, sem caráter de avaliação. Qualquer dúvida, é só responder esta mensagem. 💛`;
    result = await sendWhatsapp(admin, creds, { ...common, content: { kind: "TEXT", body } });
  } else {
    sendMode = "TEMPLATE";
    const withButton = await findActiveTemplate(admin, "RELATORIO_SESSAO_PDF");
    if (withButton) {
      result = await sendWhatsapp(admin, creds, {
        ...common,
        // v2 (4 variáveis) leva o destaque; a v3 (3 variáveis, Utility) só avisa e põe o token na URL do botão.
        content: {
          kind: "TEMPLATE",
          template: withButton,
          variables:
            withButton.variable_count >= 4
              ? { "1": guardianFirst, "2": childFirst, "3": highlight, "4": token! }
              : { "1": guardianFirst, "2": childFirst, "3": token! },
        },
      });
    } else {
      const plain = await findActiveTemplate(admin, "RELATORIO_SESSAO");
      if (!plain) return mark("SKIPPED_NO_TEMPLATE", { contactId: contact.id, aiMessage: highlight, aiFallback });
      result = await sendWhatsapp(admin, creds, {
        ...common,
        // fa_relatorio_sessao_v3 (Marketing para a Meta) leva destaque + link em {{3}}; a v4 e as seguintes só o link.
        content: {
          kind: "TEMPLATE",
          template: plain,
          variables: {
            "1": guardianFirst,
            "2": childFirst,
            "3": plain.name === "fa_relatorio_sessao_v3" ? `${highlight} Olhar FaçaAmigos completo: ${link}` : link,
          },
        },
      });
    }
  }

  if (!result.ok) return mark("FAILED", { error: result.error, sendMode, contactId: contact.id, aiMessage: highlight, aiFallback });
  return mark("SENT", { sendMode, contactId: contact.id, messageId: result.messageId, aiMessage: highlight, aiFallback });
});
