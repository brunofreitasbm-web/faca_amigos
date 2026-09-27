// Geração SOB DEMANDA do Compêndio de Vendas (Gerencial > Atendimentos
// Gravados > "Gerar compêndio da reunião"), para o gestor montar a Reunião
// de Alinhamento Mensal com um período escolhido à mão (não precisa
// esperar o cron do dia 1 — ver sales-compendium-dispatch para a versão
// automática do mês anterior).
//
// Interpreta as TRANSCRIÇÕES (texto, nunca o áudio — já apagado pelo
// worker do kiosk) com a API Gemini e devolve um resumo estruturado:
// pontos fortes, objeções recorrentes, ofertas mais eficazes, atenção por
// operador e plano de ação. De propósito SEM falas literais no retorno do
// modelo (instrução no prompt) — reduz a exposição do texto bruto de
// clientes na tela do Gerencial, que já mostra o compêndio para quem tem
// só 'treinamento.transcricoes.read' (mais gente que
// 'treinamento.compendio.gerar', que é só ADMIN).
//
// GEMINI_API_KEY aqui é um SEGREDO DE SERVIDOR (Supabase Edge Functions >
// Manage secrets) — não confundir com VITE_GEMINI_API_KEY, que é a chave
// do agente de vendas no navegador (apps/kiosk-ui/src/lib/geminiAgent.ts).
// Nunca reaproveitar a chave do navegador aqui nem vice-versa.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

const GEMINI_MODEL = "gemini-flash-latest";
const MAX_TRANSCRIPTS = 300;
const MAX_CHARS_PER_TRANSCRIPT = 1200;

interface TranscriptForPrompt {
  momento: string;
  outcome: string | null;
  employeeName: string;
  text: string;
}

export interface SalesCompendium {
  resumoExecutivo: string;
  totalAtendimentos: number;
  pontosFortes: string[];
  objecoesRecorrentes: Array<{ objecao: string; frequencia: string; sugestaoResposta: string }>;
  ofertasEficazes: Array<{ oferta: string; porque: string }>;
  porOperador: Array<{ nomeOperador: string; destaque: string; pontoDeAtencao: string }>;
  planoAcaoReuniao: string[];
}

function buildPrompt(unitLabel: string, periodLabel: string, rows: TranscriptForPrompt[]): { system: string; prompt: string } {
  const system = `Você é a ZoeIA, consultora de vendas do FaçaAmigos, preparando a Reunião de Alinhamento Mensal com a liderança.
Vai receber transcrições REAIS de conversas de check-in (venda) e check-out (retenção) do balcão.
REGRAS ABSOLUTAS:
1. NUNCA cite falas literais nem detalhes que identifiquem uma criança ou responsável específico — o compêndio é para treinar o TIME, não para expor uma família.
2. Baseie-se SOMENTE no conteúdo real das transcrições fornecidas. Se algo não aparecer nelas, não invente.
3. Seja específico e acionável: cada ponto do plano de ação deve dar para aplicar no balcão amanhã.
Responda EXCLUSIVAMENTE em formato JSON com o esquema:
{
  "resumoExecutivo": "string (3-4 frases)",
  "totalAtendimentos": number,
  "pontosFortes": ["string"],
  "objecoesRecorrentes": [{ "objecao": "string", "frequencia": "string (ex: 'em 6 de 20 atendimentos')", "sugestaoResposta": "string" }],
  "ofertasEficazes": [{ "oferta": "string", "porque": "string" }],
  "porOperador": [{ "nomeOperador": "string", "destaque": "string (o que fez bem)", "pontoDeAtencao": "string (o que treinar)" }],
  "planoAcaoReuniao": ["string (passo objetivo para discutir/aplicar na reunião)"]
}`;

  const body = rows
    .map((r, i) => `[${i + 1}] ${r.momento} — operador: ${r.employeeName}${r.outcome ? ` — resultado: ${r.outcome}` : ""}\n${r.text.slice(0, MAX_CHARS_PER_TRANSCRIPT)}`)
    .join("\n\n---\n\n");

  const prompt = `Unidade: ${unitLabel}\nPeríodo: ${periodLabel}\nTotal de transcrições nesta amostra: ${rows.length}\n\nTRANSCRIÇÕES:\n\n${body || "(nenhuma transcrição com texto neste período)"}`;

  return { system, prompt };
}

async function callGemini(apiKey: string, system: string, prompt: string): Promise<SalesCompendium | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    console.error("[sales-compendium] Gemini respondeu", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as SalesCompendium;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const auth = await requireCapability(req, "treinamento.compendio.gerar");
  if (!auth.ok) return auth.response;

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return jsonResponse(req, { error: "GEMINI_API_KEY não configurada nos segredos das Edge Functions" }, 500);
  }

  let payload: { unitId?: string | null; periodStartMs?: number; periodEndMs?: number };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  const unitId = payload.unitId ?? null;
  const periodStartMs = Number(payload.periodStartMs);
  const periodEndMs = Number(payload.periodEndMs);
  if (!Number.isFinite(periodStartMs) || !Number.isFinite(periodEndMs) || periodEndMs <= periodStartMs) {
    return jsonResponse(req, { error: "período inválido" }, 400);
  }

  // Leitura pelo client "como o chamador": a mesma RLS de
  // 'treinamento.transcricoes.read' que protege a tabela protege esta
  // consulta — um ADMIN sem essa capacidade (não deveria existir, mas por
  // garantia) não conseguiria ler nada mesmo tendo passado no requireCapability acima.
  let query = auth.callerClient
    .from("fa_kiosk_voice_transcripts")
    .select("momento, outcome, transcript, employee_id, fa_kiosk_employees(full_name)")
    .gte("started_at_ms", periodStartMs)
    .lt("started_at_ms", periodEndMs)
    .neq("transcript", "")
    .order("started_at_ms", { ascending: true })
    .limit(MAX_TRANSCRIPTS);
  if (unitId) query = query.eq("unit_id", unitId);

  const { data: transcripts, error: fetchError } = await query;
  if (fetchError) return jsonResponse(req, { error: fetchError.message }, 500);

  const rows: TranscriptForPrompt[] = (transcripts ?? []).map((t: any) => ({
    momento: t.momento,
    outcome: t.outcome,
    employeeName: t.fa_kiosk_employees?.full_name ?? "Operador",
    text: t.transcript,
  }));

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (rows.length === 0) {
    const { data: inserted, error: insertError } = await adminClient
      .from("fa_kiosk_sales_compendiums")
      .insert({
        unit_id: unitId,
        period_start_ms: periodStartMs,
        period_end_ms: periodEndMs,
        generated_by_employee_id: auth.userId,
        transcript_count: 0,
        gemini_model: GEMINI_MODEL,
        status: "EMPTY",
      })
      .select()
      .single();
    if (insertError) return jsonResponse(req, { error: insertError.message }, 500);
    return jsonResponse(req, inserted);
  }

  const unitLabel = unitId ? unitId : "Consolidado da rede";
  const periodLabel = `${new Date(periodStartMs).toISOString().slice(0, 10)} a ${new Date(periodEndMs).toISOString().slice(0, 10)}`;
  const { system, prompt } = buildPrompt(unitLabel, periodLabel, rows);
  const compendium = await callGemini(geminiKey, system, prompt);

  const { data: inserted, error: insertError } = await adminClient
    .from("fa_kiosk_sales_compendiums")
    .insert({
      unit_id: unitId,
      period_start_ms: periodStartMs,
      period_end_ms: periodEndMs,
      generated_by_employee_id: auth.userId,
      transcript_count: rows.length,
      gemini_model: GEMINI_MODEL,
      compendium: compendium,
      status: compendium ? "DONE" : "FAILED",
      error: compendium ? null : "Falha ao interpretar a resposta da API Gemini",
    })
    .select()
    .single();
  if (insertError) return jsonResponse(req, { error: insertError.message }, 500);

  return jsonResponse(req, inserted);
});
