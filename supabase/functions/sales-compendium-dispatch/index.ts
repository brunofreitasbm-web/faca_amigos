// Disparada 1x/mês (dia 1, 06h UTC) pelo pg_cron (ver migration
// 20260927220000_fa_sales_compendium.sql) — gera automaticamente o
// Compêndio de Vendas do MÊS ANTERIOR, por unidade e um consolidado da
// rede (unit_id = null), para o gestor já ter material pronto para a
// Reunião de Alinhamento Mensal sem precisar lembrar de gerar manualmente.
// Geração sob demanda com período livre vive em sales-compendium-generate
// (exige 'treinamento.compendio.gerar' e roda via chamada normal do
// Gerencial, não por cron).
//
// CORS/JSON helpers inline pelo mesmo motivo de ponto-photo-retention-
// dispatch: nunca é chamada por um navegador (só pelo pg_cron/pg_net), e o
// import relativo pro _shared causava falha de bundling no deploy via MCP.
//
// Idempotente por (unit_id, period_start_ms) via índice único em
// generated_by_employee_id IS NULL — reexecutar o mesmo mês só resulta em
// "duplicate key" ignorado (on conflict do nothing), nunca duas linhas.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-flash-latest";
const MAX_TRANSCRIPTS = 300;
const MAX_CHARS_PER_TRANSCRIPT = 1200;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface TranscriptForPrompt {
  momento: string;
  outcome: string | null;
  employeeName: string;
  text: string;
}

function previousMonthRangeMs(nowMs: number): { periodStartMs: number; periodEndMs: number } {
  const now = new Date(nowMs);
  const firstOfThisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const firstOfPrevMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  return { periodStartMs: firstOfPrevMonth, periodEndMs: firstOfThisMonth };
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

async function callGemini(apiKey: string, system: string, prompt: string): Promise<Record<string, unknown> | null> {
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
    console.error("[sales-compendium-dispatch] Gemini respondeu", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateForScope(
  adminClient: ReturnType<typeof createClient>,
  geminiKey: string,
  unitId: string | null,
  unitLabel: string,
  periodStartMs: number,
  periodEndMs: number,
): Promise<"created" | "skipped" | "failed"> {
  let query = adminClient
    .from("fa_kiosk_voice_transcripts")
    .select("momento, outcome, transcript, fa_kiosk_employees(full_name)")
    .gte("started_at_ms", periodStartMs)
    .lt("started_at_ms", periodEndMs)
    .neq("transcript", "")
    .order("started_at_ms", { ascending: true })
    .limit(MAX_TRANSCRIPTS);
  if (unitId) query = query.eq("unit_id", unitId);

  const { data: transcripts, error: fetchError } = await query;
  if (fetchError) {
    console.error("[sales-compendium-dispatch] falha ao ler transcrições:", fetchError.message);
    return "failed";
  }

  const rows: TranscriptForPrompt[] = (transcripts ?? []).map((t: any) => ({
    momento: t.momento,
    outcome: t.outcome,
    employeeName: t.fa_kiosk_employees?.full_name ?? "Operador",
    text: t.transcript,
  }));

  const base = { unit_id: unitId, period_start_ms: periodStartMs, period_end_ms: periodEndMs, generated_by_employee_id: null, gemini_model: GEMINI_MODEL };

  if (rows.length === 0) {
    const { error } = await adminClient.from("fa_kiosk_sales_compendiums").insert({ ...base, transcript_count: 0, status: "EMPTY" });
    if (error && !error.message.includes("duplicate")) console.error("[sales-compendium-dispatch] insert EMPTY:", error.message);
    return "skipped";
  }

  const periodLabel = `${new Date(periodStartMs).toISOString().slice(0, 10)} a ${new Date(periodEndMs).toISOString().slice(0, 10)}`;
  const { system, prompt } = buildPrompt(unitLabel, periodLabel, rows);
  const compendium = await callGemini(geminiKey, system, prompt);

  const { error } = await adminClient.from("fa_kiosk_sales_compendiums").insert({
    ...base,
    transcript_count: rows.length,
    compendium,
    status: compendium ? "DONE" : "FAILED",
    error: compendium ? null : "Falha ao interpretar a resposta da API Gemini",
  });
  if (error && !error.message.includes("duplicate")) {
    console.error("[sales-compendium-dispatch] insert:", error.message);
    return "failed";
  }
  return compendium ? "created" : "failed";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Content-Type": "application/json" } });

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return jsonResponse({ error: "GEMINI_API_KEY não configurada" }, 500);

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { periodStartMs, periodEndMs } = previousMonthRangeMs(Date.now());

  const { data: units, error: unitsError } = await adminClient.from("fa_kiosk_units").select("id, name");
  if (unitsError) return jsonResponse({ error: unitsError.message }, 500);

  const results: Record<string, string> = {};

  // Consolidado da rede primeiro.
  results["REDE"] = await generateForScope(adminClient, geminiKey, null, "Consolidado da rede", periodStartMs, periodEndMs);

  for (const unit of (units ?? []) as Array<{ id: string; name: string }>) {
    results[unit.name] = await generateForScope(adminClient, geminiKey, unit.id, unit.name, periodStartMs, periodEndMs);
  }

  return jsonResponse({ periodStartMs, periodEndMs, results });
});
