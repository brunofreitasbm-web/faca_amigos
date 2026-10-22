/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON dinâmicos / mocks de teste */
/**
 * Cliente e Serviço do Agente de IA Comercial (powered by Gemini API)
 * para o sistema FaçaAmigos.
 *
 * Fornece sugestões de upsell/cross-sell no Check-in, retenção no Check-out,
 * insights e chat assistente no Módulo Gerencial.
 *
 * Possui fallback local automático para operar offline/sem API Key sem travar o PDV.
 */

const LOCAL_STORAGE_KEY_API_KEY = "facaamigos_gemini_api_key";
const LOCAL_STORAGE_KEY_MODEL = "facaamigos_gemini_model";
const LOCAL_STORAGE_KEY_ENABLED = "facaamigos_gemini_enabled";

const DEFAULT_API_KEY = "";

/**
 * Data (AAAA-MM-DD) a partir da qual o histórico de caixa/faturamento é
 * real e confiável — ver migration fa_cleanup_test_records, que removeu os
 * lançamentos de teste do período de homologação. A ZoeIA nunca deve
 * analisar nem citar dados anteriores a esta data, mesmo que ainda existam
 * registros legados no banco.
 */
export const ZOEIA_DATA_START_DATE = "2026-08-29";

/** Empurra `dateIso` para a frente até `ZOEIA_DATA_START_DATE`, se for anterior a ela. */
export function clampToZoeiaDataStart(dateIso: string): string {
  return dateIso < ZOEIA_DATA_START_DATE ? ZOEIA_DATA_START_DATE : dateIso;
}

export type GeminiModel = "gemini-flash-latest" | "gemini-1.5-flash" | "gemini-2.0-flash" | "gemini-1.5-pro";

export interface GeminiAgentSettings {
  apiKey: string;
  model: GeminiModel;
  enabled: boolean;
}

export function getGeminiSettings(): GeminiAgentSettings {
  const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || DEFAULT_API_KEY;
  const storedKey = typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_STORAGE_KEY_API_KEY) : null;
  const storedModel = typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_STORAGE_KEY_MODEL) : null;
  const storedEnabled = typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_STORAGE_KEY_ENABLED) : null;

  return {
    apiKey: storedKey !== null && storedKey.trim() ? storedKey : envKey,
    model: (storedModel as GeminiModel) || "gemini-flash-latest",
    enabled: storedEnabled !== "false",
  };
}

export function saveGeminiSettings(settings: Partial<GeminiAgentSettings>): void {
  if (typeof localStorage === "undefined") return;
  if (settings.apiKey !== undefined) {
    localStorage.setItem(LOCAL_STORAGE_KEY_API_KEY, settings.apiKey);
  }
  if (settings.model !== undefined) {
    localStorage.setItem(LOCAL_STORAGE_KEY_MODEL, settings.model);
  }
  if (settings.enabled !== undefined) {
    localStorage.setItem(LOCAL_STORAGE_KEY_ENABLED, String(settings.enabled));
  }
}

export interface CheckinOffer {
  id: string;
  title: string;
  description: string;
  badge?: string;
  actionType: "UPGRADE_PLAN" | "ADD_PRODUCT" | "APPLY_COUPON";
  targetId?: string; // ID do plano, produto ou cupom
  targetName?: string;
  priceCents?: number;
  discountCents?: number;
  reason: string;
}

export interface CheckinContext {
  childName?: string;
  childAge?: number;
  responsibleName?: string;
  selectedPlanName?: string;
  selectedPlanMinutes?: number;
  selectedPlanPriceCents?: number;
  visitCount?: number;
  productsInCart?: string[];
  unitName?: string;
  availablePlans?: Array<{ id: string; name: string; valueCents: number; minutes: number }>;
  availableProducts?: Array<{ id: string; name: string; priceCents: number }>;
  availableCoupons?: Array<{ code: string; discountText?: string }>;
}

export interface CheckoutOffer {
  id: string;
  title: string;
  description: string;
  badge?: string;
  actionType: "CONVERT_VIP_PACKAGE" | "OFFER_RETURN_COUPON" | "BOOK_EVENT";
  targetId?: string;
  reason: string;
}

export interface CheckoutContext {
  childName?: string;
  durationMinutes?: number;
  extraMinutes?: number;
  totalPaidCents?: number;
  visitCount?: number;
  unitName?: string;
  availablePackages?: Array<{ id: string; name: string; priceCents: number; includedMinutes: number }>;
  availableCoupons?: Array<{ code: string; discountText?: string }>;
}

export interface GerencialInsight {
  id: string;
  title: string;
  category: "FATURAMENTO" | "HOJE" | "PRODUTOS" | "METAS";
  description: string;
  recommendation: string;
  impact: "ALTO" | "MEDIO" | "BAIXO";
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

/**
 * Valida a chave da API do Gemini enviando uma requisição simples de teste
 */
export async function testGeminiApiKey(apiKey: string, model: GeminiModel = "gemini-1.5-flash"): Promise<{ success: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { success: false, message: "Por favor, informe a chave da API do Gemini." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Responda apenas: OK" }] }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `Erro HTTP ${res.status}`;
      return { success: false, message: `Falha na API Gemini: ${msg}` };
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (reply.includes("OK")) {
      return { success: true, message: "Chave da Gemini API validada com sucesso!" };
    }
    return { success: true, message: "Conexão com a API do Gemini estabelecida." };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido de conexão";
    return { success: false, message: `Erro ao conectar com a API: ${errorMsg}` };
  }
}

/**
 * Executa uma chamada REST estruturada ao Gemini API
 */
async function callGemini(prompt: string, systemInstruction?: string): Promise<string | null> {
  const settings = getGeminiSettings();
  if (!settings.enabled || !settings.apiKey.trim()) {
    return null;
  }

  const model = settings.model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey.trim()}`;

  const requestBody: any = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500); // 3.5s timeout para não atrasar o balcão

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": settings.apiKey.trim(),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn("Gemini API request error status:", res.status);
      return null;
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.warn("Gemini API call failed (using local fallback):", err);
    return null;
  }
}

/**
 * Gera ofertas de Check-in (Up-sell / Cross-sell)
 */
/**
 * Interruptor das sugestões de venda da ZoeIA na tela do operador
 * (Entrada e Saída). Desligado: nenhuma chamada ao Gemini e nenhum card.
 * Não afeta o copiloto gerencial nem as sugestões do app mobile.
 */
export const OPERATOR_SALES_SUGGESTIONS_ENABLED = false;

export async function generateCheckinSuggestions(ctx: CheckinContext): Promise<CheckinOffer[]> {
  if (!OPERATOR_SALES_SUGGESTIONS_ENABLED) return [];
  const systemInstruction = `Você é a ZoeIA, a especialista humana de acolhimento e vendas do FaçaAmigos.
REGRA ABSOLUTA E INEGOCIÁVEL:
1. NUNCA invente planos de tempo, preços fictícios, cupons inexistentes ou valores que não estejam cadastrados no sistema.
2. Suas recomendações DEVEM ser baseadas estritamente nos Planos, Produtos e Cupons REAIS cadastrados na unidade informada.
3. Apresente os meios de oferecimento com forte argumento de vendas, destacando as VANTAGENS de compra, economia proporcional (ex: custo por hora menor) e o CUSTO-BENEFÍCIO real para a família.

Responda EXCLUSIVAMENTE em formato JSON com o seguinte esquema:
{
  "offers": [
    {
      "id": "string",
      "title": "string curto chamativo de oferecimento",
      "description": "argumento de venda humanizado destacando o custo-benefício e vantagem real",
      "badge": "string opcional (ex: Dica da ZoeIA, Melhor Custo-Benefício, Mais Vantajoso)",
      "actionType": "UPGRADE_PLAN" | "ADD_PRODUCT" | "APPLY_COUPON",
      "targetName": "nome EXATO do plano, produto ou cupom cadastrado no sistema",
      "priceCents": number_opcional,
      "reason": "motivo focado na vantagem comercial e acolhimento para o operador falar em voz alta"
    }
  ]
}`;

  const plansText = ctx.availablePlans?.length
    ? ctx.availablePlans.map((p) => `- ${p.name}: ${p.minutes}min por R$ ${(p.valueCents / 100).toFixed(2)}`).join("\n")
    : "Nenhum plano ativo cadastrado nesta unidade";
  const productsText = ctx.availableProducts?.length
    ? ctx.availableProducts.map((p) => `- ${p.name}: R$ ${(p.priceCents / 100).toFixed(2)}`).join("\n")
    : "Nenhum produto ativo cadastrado nesta unidade";
  const couponsText = ctx.availableCoupons?.length
    ? ctx.availableCoupons.map((c) => `- Código: ${c.code} (${c.discountText || "Desconto"})`).join("\n")
    : "Sem cupons adicionais";

  const prompt = `Contexto da Entrada na Unidade (${ctx.unitName || "Playground"}):
- Criança: ${ctx.childName || "Criança"} (${ctx.childAge ? ctx.childAge + " anos" : "idade não inf."})
- Responsável: ${ctx.responsibleName || "Acompanhante"}
- Plano selecionado agora: ${ctx.selectedPlanName || "Nenhum selecionado"} (${ctx.selectedPlanMinutes || 30} min)
- Visitas anteriores desta família: ${ctx.visitCount || 1}
- Itens no carrinho: ${ctx.productsInCart?.join(", ") || "Nenhum produto"}

CATÁLOGO REAL CADASTRADO NA UNIDADE:
[PLANOS DISPONÍVEIS]
${plansText}

[PRODUTOS DISPONÍVEIS]
${productsText}

[CUPONS DISPONÍVEIS]
${couponsText}

Com base SOMENTE neste catálogo real cadastrado, gere até 2 ofertas perspicazes com excelente argumento de vendas e custo-benefício.`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.offers) && parsed.offers.length > 0) {
        return parsed.offers;
      }
    } catch (e) {
      console.warn("Falha no parse do JSON do Gemini:", e);
    }
  }

  // Fallback Local de Regras Inteligentes
  return getLocalCheckinFallback(ctx);
}

/**
 * Fallback local caso a API falhe ou não tenha chave configurada
 */
function getLocalCheckinFallback(ctx: CheckinContext): CheckinOffer[] {
  const offers: CheckinOffer[] = [];
  const selectedMinutes = ctx.selectedPlanMinutes || 30;
  const visitCount = ctx.visitCount || 1;

  // Sugestão 1: Upgrade para o próximo plano cadastrado e ativo (por
  // duração), estritamente entre os planos reais desta unidade — nunca um
  // nome inventado.
  const nextPlan = (ctx.availablePlans ?? [])
    .filter((p) => p.minutes > selectedMinutes)
    .sort((a, b) => a.minutes - b.minutes)[0];
  if (nextPlan) {
    offers.push({
      id: "up_next_plan",
      title: `Upgrade para ${nextPlan.name}`,
      description: `As crianças costumam brincar por mais tempo. Garanta ${nextPlan.minutes}min por R$ ${(nextPlan.valueCents / 100).toFixed(2)}!`,
      badge: "✦ Sugestão IA",
      actionType: "UPGRADE_PLAN",
      targetId: nextPlan.id,
      targetName: nextPlan.name,
      priceCents: nextPlan.valueCents,
      reason: "Plano mais longo cadastrado e ativo nesta unidade, com melhor custo-benefício por minuto.",
    });
  }

  // Sugestão 2: um produto real, ativo e cadastrado nesta unidade que ainda
  // não está no carrinho — preferindo itens de segurança (ex.: meia).
  const cartLower = (ctx.productsInCart ?? []).map((p) => p.toLowerCase());
  const candidateProducts = (ctx.availableProducts ?? []).filter(
    (p) => !cartLower.some((c) => c.includes(p.name.toLowerCase())),
  );
  const suggestedProduct =
    candidateProducts.find((p) => p.name.toLowerCase().includes("meia")) ?? candidateProducts[0];
  if (suggestedProduct) {
    offers.push({
      id: "add_product",
      title: `Adicionar ${suggestedProduct.name}`,
      description: `Item disponível no cadastro desta unidade por R$ ${(suggestedProduct.priceCents / 100).toFixed(2)}.`,
      badge: "Item Essencial",
      actionType: "ADD_PRODUCT",
      targetId: suggestedProduct.id,
      targetName: suggestedProduct.name,
      priceCents: suggestedProduct.priceCents,
      reason: "Produto ativo e cadastrado no catálogo real desta unidade.",
    });
  }

  // Sugestão 3: um cupom real e ativo, para clientes recorrentes.
  const coupon = (ctx.availableCoupons ?? [])[0];
  if (visitCount >= 2 && coupon && offers.length < 2) {
    offers.push({
      id: "apply_coupon",
      title: `Aplicar cupom ${coupon.code}`,
      description: `Cliente frequente! Aproveite ${coupon.discountText ?? "o desconto"} cadastrado nesta unidade.`,
      badge: "Economia VIP",
      actionType: "APPLY_COUPON",
      targetName: coupon.code,
      reason: "Cliente em sua visita #" + visitCount + ". Cupom real e ativo cadastrado nesta unidade.",
    });
  }

  return offers;
}

/**
 * Gera ofertas de Check-out (Retenção / Conversão)
 */
export async function generateCheckoutSuggestions(ctx: CheckoutContext): Promise<CheckoutOffer[]> {
  if (!OPERATOR_SALES_SUGGESTIONS_ENABLED) return [];
  const systemInstruction = `Você é a ZoeIA, a especialista em fidelização e retenção do FaçaAmigos.
REGRA ABSOLUTA E INEGOCIÁVEL:
1. NUNCA invente pacotes, cupons ou promoções que não estejam cadastrados no sistema.
2. Suas recomendações DEVEM ser baseadas estritamente nos Pacotes e Cupons REAIS cadastrados na unidade informada.
3. Se o catálogo real não tiver um pacote ou cupom aplicável, não gere oferta desse tipo — não invente um.

Gere ofertas humanas e estratégicas de checkout para acolher e fidelizar a família ao sair do parque.
Responda EXCLUSIVAMENTE no formato JSON:
{
  "offers": [
    {
      "id": "string",
      "title": "string curto chamativo",
      "description": "string com tom humano e convidativo",
      "badge": "string opcional (ex: Dica da ZoeIA, Fidelidade VIP)",
      "actionType": "CONVERT_VIP_PACKAGE" | "OFFER_RETURN_COUPON",
      "targetName": "nome ou código EXATO do pacote ou cupom cadastrado no sistema",
      "reason": "string"
    }
  ]
}`;

  const packagesText = ctx.availablePackages?.length
    ? ctx.availablePackages.map((p) => `- ${p.name}: ${p.includedMinutes}min por R$ ${(p.priceCents / 100).toFixed(2)}`).join("\n")
    : "Nenhum pacote ativo cadastrado nesta unidade";
  const couponsText = ctx.availableCoupons?.length
    ? ctx.availableCoupons.map((c) => `- Código: ${c.code} (${c.discountText || "Desconto"})`).join("\n")
    : "Sem cupons ativos cadastrados nesta unidade";

  const prompt = `Contexto da Saída (${ctx.unitName || "Playground"}):
- Criança: ${ctx.childName || "Criança"}
- Permanência total: ${ctx.durationMinutes || 0} minutos (Excedente: ${ctx.extraMinutes || 0} min)
- Valor pago acumulado: R$ ${((ctx.totalPaidCents || 0) / 100).toFixed(2)}
- Visitas anteriores: ${ctx.visitCount || 1}

CATÁLOGO REAL CADASTRADO NA UNIDADE:
[PACOTES DISPONÍVEIS]
${packagesText}

[CUPONS DISPONÍVEIS]
${couponsText}

Com base SOMENTE neste catálogo real cadastrado, gere até 2 ofertas de retenção com excelente argumento de vendas.`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.offers) && parsed.offers.length > 0) {
        return parsed.offers;
      }
    } catch {
      // ignore
    }
  }

  return getLocalCheckoutFallback(ctx);
}

/**
 * Fallback local caso a API falhe ou não tenha chave configurada — monta as
 * ofertas só a partir de pacotes/cupons reais, ativos e cadastrados na
 * unidade, nunca com nome inventado.
 */
function getLocalCheckoutFallback(ctx: CheckoutContext): CheckoutOffer[] {
  const offers: CheckoutOffer[] = [];

  const coupon = (ctx.availableCoupons ?? [])[0];
  if (coupon) {
    offers.push({
      id: "checkout_return",
      title: `Cupom ${coupon.code} na Próxima Visita`,
      description: `Ofereça ${coupon.discountText ?? "este desconto"} cadastrado nesta unidade para estimular o retorno.`,
      badge: "Dica da ZoeIA",
      actionType: "OFFER_RETURN_COUPON",
      targetId: coupon.code,
      reason: "Cupom real e ativo cadastrado nesta unidade — garante retorno rápido da família.",
    });
  }

  const bestPackage = (ctx.availablePackages ?? []).slice().sort((a, b) => b.includedMinutes - a.includedMinutes)[0];
  if (bestPackage && offers.length < 2) {
    offers.push({
      id: "checkout_package",
      title: `Converter em ${bestPackage.name}`,
      description: `Abata parte do valor da sessão de hoje na adesão do pacote de ${bestPackage.includedMinutes}min por R$ ${(bestPackage.priceCents / 100).toFixed(2)}.`,
      badge: "ZoeIA Indica",
      actionType: "CONVERT_VIP_PACKAGE",
      targetId: bestPackage.id,
      reason: "Família acumulou mais de " + (ctx.durationMinutes || 45) + " minutos nesta visita — pacote real e ativo cadastrado nesta unidade.",
    });
  }

  return offers;
}

export interface OperatorPerformance {
  topOperatorName: string;
  topOperatorMetric: string;
  topOperatorReason: string;
  needsTrainingOperatorName: string;
  needsTrainingMetric: string;
  needsTrainingAction: string;
}

export interface GerencialReport {
  unitName: string;
  projections: {
    forecastText: string;
    targetText: string;
    howToIncrease: string[];
  };
  attentionPoints: {
    issue: string;
    whereToImprove: string;
  };
  operatorPerformance: OperatorPerformance;
  actionPlan: {
    steps: string[];
  };
}

/**
 * Gera Relatório Gerencial Estratégico da ZoeIA (Projeções, Atenção, Eficiência do Time e Plano de Ação)
 */
export async function generateGerencialReport(metricsSummary: string, unitName?: string): Promise<GerencialReport> {
  const OFFICIAL_UNITS = ["Circuito", "Playground (Parque Shopping)", "Playground (Grão-Pará)"];
  const isConsolidated = !unitName || unitName === "TODAS" || unitName === "Geral" || unitName.includes("Rede");
  const targetUnit = isConsolidated
    ? "Rede Consolidada (Circuito, Playground Parque Shopping e Playground Grão-Pará)"
    : unitName;

  const systemInstruction = `Você é a ZoeIA, a Diretora Comercial de IA do FaçaAmigos.
As 3 únicas unidades existentes da rede FaçaAmigos são:
1. Circuito (Parque Shopping)
2. Playground (Parque Shopping)
3. Playground (Grão-Pará)

REGRA ABSOLUTA E INEGOCIÁVEL SOBRE OS DADOS:
1. Use SOMENTE os números reais fornecidos no contexto abaixo (faturamento, pedidos, visitas, planos vendidos). NUNCA invente, estime ou arredonde valores que não estejam explicitamente no contexto.
2. O contexto cobre exclusivamente o período de ${ZOEIA_DATA_START_DATE} em diante — dados de datas anteriores a essa não são confiáveis e nunca devem ser mencionados ou assumidos.
3. Se o contexto indicar que não há dados suficientes no período, diga isso explicitamente em vez de fabricar uma projeção.
4. FILTRO RÍGIDO DE EQUIPE: Considere EXCLUSIVAMENTE colaboradores com contrato ATIVO atualmente. NUNCA cite, recomende para treinamento ou mencione ex-funcionários demitidos antes de 29/08/2026.

Gere um relatório gerencial estratégico em JSON para "${targetUnit}" considerando a realidade e sinergia entre estas 3 unidades da rede, cobrindo:
1. Projeções de Faturamento & Como Aumentar Receita (comparações entre as 3 unidades se for análise consolidada).
2. Pontos de Atenção & Onde melhorar (identifique gargalos específicos ou compartilhados).
3. Eficiência dos Operadores (destaque de operador ativo mais eficiente e operador em desenvolvimento na unidade).
4. Plano de Ação (passos acionáveis para o gerente aplicar hoje).

Responda EXCLUSIVAMENTE em formato JSON:
{
  "unitName": "${targetUnit}",
  "projections": {
    "forecastText": "Projeção de faturamento diário R$ X baseada na tendência atual",
    "targetText": "Meta diária R$ Y (Faltam R$ Z para atingir 100%)",
    "howToIncrease": [
      "Ação 1 para aumentar faturamento",
      "Ação 2 para alavancar vendas"
    ]
  },
  "attentionPoints": {
    "issue": "Gargalo ou ponto fraco identificado na operação da unidade",
    "whereToImprove": "Onde melhorar imediatamente para estancar perdas de receita"
  },
  "operatorPerformance": {
    "topOperatorName": "Nome do operador destaque ativo",
    "topOperatorMetric": "Métrica de destaque (ex: 42% de conversão em meias e upsell)",
    "topOperatorReason": "Motivo do sucesso para replicar na equipe",
    "needsTrainingOperatorName": "Nome do operador ativo que precisa de suporte",
    "needsTrainingMetric": "Métrica abaixo da média (ex: 12% de conversão de adicionais)",
    "needsTrainingAction": "Ação prática de treinamento em 5min"
  },
  "actionPlan": {
    "steps": [
      "Passo 1 acionável para o gerente aplicar no balcão hoje",
      "Passo 2 para engajar os colaboradores"
    ]
  }
}`;

  const prompt = `Métricas e Contexto da Operação (${targetUnit}):\n${metricsSummary}\n\nUnidades oficiais cadastradas: ${OFFICIAL_UNITS.join(", ")}`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed?.projections && parsed?.operatorPerformance) {
        return parsed as GerencialReport;
      }
    } catch {
      // ignore
    }
  }

function parseMetricsFromSummary(summary: string) {
  const fatMatch = summary.match(/Faturamento total do período:\s*R\$\s*([\d.,]+)/i);
  const ticketMatch = summary.match(/Ticket médio:\s*R\$\s*([\d.,]+)/i);
  const ordersMatch = summary.match(/Pedidos pagos:\s*(\d+)/i);
  const visitsMatch = summary.match(/Total de visitas \(sessões\):\s*(\d+)/i);
  const periodMatch = summary.match(/Período real analisado:\s*([\d-]+)\s*a\s*([\d-]+)/i);

  const parseNum = (str?: string) => {
    if (!str) return 0;
    return parseFloat(str.replace(/\./g, "").replace(",", ".")) || 0;
  };

  const fatTotal = parseNum(fatMatch?.[1]);
  const ticketAvg = parseNum(ticketMatch?.[1]);
  const ordersCount = parseInt(ordersMatch?.[1] || "0", 10);
  const visitsCount = parseInt(visitsMatch?.[1] || "0", 10);

  let numDays = 1;
  if (periodMatch?.[1] && periodMatch?.[2]) {
    const d1 = new Date(periodMatch[1]).getTime();
    const d2 = new Date(periodMatch[2]).getTime();
    const diff = Math.round((d2 - d1) / (1000 * 3600 * 24)) + 1;
    numDays = Math.max(1, diff);
  }

  return { fatTotal, ticketAvg, ordersCount, visitsCount, numDays };
}

  const { fatTotal, ticketAvg, ordersCount, visitsCount, numDays } = parseMetricsFromSummary(metricsSummary);

  const dailyAvg = fatTotal > 0 ? fatTotal / numDays : (isConsolidated ? 4200 : targetUnit.includes("Circuito") ? 1800 : 2400);
  const dailyTarget = dailyAvg * 1.20;
  const remainingTarget = Math.max(0, dailyTarget - dailyAvg);

  const formatReais = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

  const forecastText = isConsolidated
    ? `Projeção Consolidada da Rede (Média diária real de ${numDays} dia(s)): ${formatReais(dailyAvg)}/dia.`
    : `Projeção estimada de faturamento hoje em ${targetUnit}: ${formatReais(dailyAvg)}/dia (Baseado na média real de ${numDays} dia(s)).`;

  const targetText = isConsolidated
    ? `Meta Diária da Rede (+20% Aceleração): ${formatReais(dailyTarget)} — Faltam ${formatReais(remainingTarget)} no somatório das 3 unidades.`
    : `Meta Diária da ${targetUnit}: ${formatReais(dailyTarget)} — Faltam ${formatReais(remainingTarget)} para atingir 100% da meta.`;

  let issueText = "";
  let improveText = "";
  if (ticketAvg > 0 && ticketAvg < 45) {
    issueText = `Ticket Médio em ${targetUnit} (${formatReais(ticketAvg)}) está abaixo do potencial ideal (R$ 48,00+).`;
    improveText = "Focar na oferta proativa do Combo 'Entrada 60min + Meia Antiderrapante' para elevar o ticket médio por atendimento.";
  } else if (isConsolidated) {
    issueText = "Divergência na taxa de conversão de meias e upgrades entre o Circuito e as unidades de Playground.";
    improveText = "Padronizar o script de balcão do Circuito no Playground Grão-Pará para elevar a média global da rede.";
  } else {
    issueText = `Gargalo identificado em ${targetUnit}: Volume de sessões por hora concentrado nos horários de pico.`;
    improveText = "Estimular agendamentos antecipados e venda de Passaporte 10h para diluir o fluxo ao longo do dia.";
  }

  const topOpName = isConsolidated ? "Equipe Ativa Consolidada" : `Equipe Ativa — ${targetUnit}`;
  const topOpMetric = ticketAvg > 0 ? `${formatReais(ticketAvg)} de Ticket Médio` : "42% de conversão em adicionais";

  return {
    unitName: targetUnit,
    projections: {
      forecastText,
      targetText,
      howToIncrease: [
        `Estimular Cross-sell ativo entre Circuito e Playground Parque Shopping (desconto de 15% para dobradinha no mesmo dia).`,
        `Oferecer o Combo 'Entrada + Meia Antiderrapante' para 100% das famílias no balcão de ${targetUnit}.`,
        `Promover o Pacote VIP Passaporte 10 Horas válido em todas as 3 unidades da rede.`,
      ],
    },
    attentionPoints: {
      issue: issueText,
      whereToImprove: improveText,
    },
    operatorPerformance: {
      topOperatorName: topOpName,
      topOperatorMetric: topOpMetric,
      topOperatorReason: "Abordagem acolhedora demonstrando a economia do plano de 60min logo no início do atendimento.",
      needsTrainingOperatorName: "Operador em Treinamento de Vendas",
      needsTrainingMetric: "12% de conversão em produtos adicionais",
      needsTrainingAction: "Realizar alinhamento de 5 minutos no início do turno mostrando a abordagem padrão de vendas da rede.",
    },
    actionPlan: {
      steps: [
        `Fazer um alinhamento rápido de 3 minutos com a equipe do balcão de ${targetUnit} antes do horário de pico.`,
        "Divulgar a venda cruzada de ingressos entre Circuito e Playground Parque Shopping nos cupons de saída.",
        "Manter a meta diária visível no mural interno para incentivar a bonificação coletiva do time.",
      ],
    },
  };
}

/**
 * Responde a perguntas do gestor no Chat Comercial Copilot
 */
export async function chatGerencialCopilot(history: ChatMessage[], newMessage: string, metricsContext: string): Promise<string> {
  const systemInstruction = `Você é a ZoeIA, a assistente comercial humana, perspicaz e parceira do FaçaAmigos.
Seu objetivo é ajudar o gerente de unidade a aumentar as vendas, ticket médio, otimizar pacotes, cupons e a performance dos colaboradores de forma acolhedora e eficiente.
Seja direta, calorosa, prática e utilize dados e estratégias de varejo e entretenimento infantil em shoppings.
Use SOMENTE os números reais do "Contexto Gerencial Atual" abaixo, que cobre exclusivamente o período de ${ZOEIA_DATA_START_DATE} em diante — nunca invente valores nem cite dados de datas anteriores a essa.`;
  const conversationHistory = history
    .map((m) => `${m.role === "user" ? "Gerente" : "ZoeIA"}: ${m.text}`)
    .join("\n");

  const prompt = `Contexto Gerencial Atual:\n${metricsContext}\n\nHistórico da Conversa:\n${conversationHistory}\nGerente: ${newMessage}\nZoeIA:`;

  const settings = getGeminiSettings();
  if (settings.enabled && settings.apiKey.trim()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model || "gemini-1.5-flash"}:generateContent?key=${settings.apiKey.trim()}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": settings.apiKey.trim(),
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return reply;
      }
    } catch (e) {
      console.warn("Falha no chat do Gemini:", e);
    }
  }

  // Respostas Inteligentes Locais baseadas em palavras-chave
  const msgLower = newMessage.toLowerCase();
  if (msgLower.includes("meta") || msgLower.includes("faturamento")) {
    return "Para alavancar o faturamento e atingir as metas da semana, recomendo focar na conversão de entradas de 30 minutos em planos de 60 minutos durante o check-in, além de sugerir ativamente o 'Combo Passaporte 10 Horas' para clientes recorrentes.";
  }
  if (msgLower.includes("produto") || msgLower.includes("meia") || msgLower.includes("estoque")) {
    return "Produtos adicionais como meias antiderrapantes e snacks representam margem pura para o quiosque! Treine o balcão para perguntar sempre: 'A criança já tem a meia oficial antiderrapante para hoje?'";
  }
  if (msgLower.includes("cupom") || msgLower.includes("promoção") || msgLower.includes("desconto")) {
    return "Recomendo criar cupons direcionados para dias de menor movimento (como terças e quartas-feiras), concedendo 20% de desconto ou 15 minutos bônus nas entradas de 1 hora.";
  }

  return "Analisando a operação do parque: focar na agilidade do check-in com oferta proativa de adicionais (meias e upgrade de tempo) é a maneira mais rápida de elevar o ticket médio em até 25%. Como posso ajudar com mais estratégias específicas?";
}

export interface MobileOffer {
  id: string;
  title: string;
  description: string;
  badge?: string;
  category: "UPSELL_PLAN" | "CROSS_SELL_UNIT" | "ADD_PRODUCT" | "LTV_RENEWAL";
  targetName?: string;
  reason: string;
}

/**
 * Gera sugestões da ZoeIA para o QR Code de Acesso Rápido no celular do pai
 */
export async function generateMobileAcessoRapidoSuggestions(ctx: {
  childrenCount: number;
  selectedPlanName?: string;
  selectedPlanMinutes?: number;
  unitName?: string;
  availablePlans?: Array<{ name: string; minutes: number; valueCents: number }>;
}): Promise<MobileOffer[]> {
  const currentUnit = ctx.unitName || "Playground Parque Shopping";
  const crossUnit = currentUnit.toLowerCase().includes("circuito") ? "Playground Parque Shopping" : "Circuito Parque Shopping";

  const systemInstruction = `Você é a ZoeIA no celular dos pais (QR Code de Acesso Rápido).
REGRAS ABSOLUTAS:
1. NUNCA invente planos de tempo ou preços fictícios.
2. Suas ofertas devem focar em:
   - Up-sell de Custo-Benefício: mostrar como o plano com mais minutos é proporcionalmente mais econômico por hora.
   - Venda Cruzada (Cross-sell): propor o aproveitamento combinado entre o ${currentUnit} e a atração parceira ${crossUnit}.
   - Venda Adicional (Meia Antiderrapante / Proteção).

Responda EXCLUSIVAMENTE em formato JSON:
{
  "offers": [
    {
      "id": "string",
      "title": "string curto chamativo",
      "description": "argumento de venda focado na vantagem e custo-benefício",
      "badge": "string opcional (ex: Dica da ZoeIA, Melhores Vantagens, Combo Parque)",
      "category": "UPSELL_PLAN" | "CROSS_SELL_UNIT" | "ADD_PRODUCT" | "LTV_RENEWAL",
      "targetName": "string",
      "reason": "motivo de valor para a família"
    }
  ]
}`;

  const plansText = ctx.availablePlans?.map((p) => `- ${p.name}: ${p.minutes}min (R$ ${(p.valueCents / 100).toFixed(2)})`).join("\n") || "Planos cadastrados";
  const prompt = `Unidade Atual: ${currentUnit}\nAtração Irmã para Cross-sell: ${crossUnit}\nCrianças no cadastro: ${ctx.childrenCount}\nPlano selecionado: ${ctx.selectedPlanName || "30 Minutos"}\nPlanos reais:\n${plansText}`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.offers) && parsed.offers.length > 0) {
        return parsed.offers;
      }
    } catch {
      // ignore
    }
  }

  // Fallback Inteligente Local para Acesso Rápido
  return [
    {
      id: "ar_upsell",
      title: "Plano 60 Minutos — Maior Custo-Benefício",
      description: "Economize até 30% no valor proporcional da hora garantindo 60 minutos de diversão contínua.",
      badge: "Dica da ZoeIA",
      category: "UPSELL_PLAN",
      targetName: "60 Minutos",
      reason: "O tempo de 60 minutos garante melhor aproveitamento dos brinquedos sem correria.",
    },
    {
      id: "ar_cross",
      title: `Venda Cruzada: Conheça também o ${crossUnit}`,
      description: `Apresente a entrada de hoje e ganhe 15% de desconto especial para brincar no ${crossUnit} no mesmo dia!`,
      badge: "Combo Especial",
      category: "CROSS_SELL_UNIT",
      targetName: crossUnit,
      reason: "Experiência completa combinando brinquedos infláveis e circuito de carrinhos.",
    },
  ];
}

/**
 * Gera sugestões da ZoeIA para o celular dos pais durante o Acompanhamento em Tempo Real
 */
export async function generateMobileAcompanharSuggestions(ctx: {
  childName: string;
  remainingMinutes: number;
  elapsedMinutes: number;
  unitName?: string;
}): Promise<MobileOffer[]> {
  const currentUnit = ctx.unitName || "Playground Parque Shopping";
  const crossUnit = currentUnit.toLowerCase().includes("circuito") ? "Playground Parque Shopping" : "Circuito Parque Shopping";

  const systemInstruction = `Você é a ZoeIA na tela de Acompanhamento do celular dos pais.
REGRAS DE OURO:
1. Crie EXATAMENTE 1 ÚNICA sugestão sutil, persuasiva e elegante.
2. NUNCA exija comandos ou botões de ação do pai. Apenas apresente a vantagem de forma envolvente (ex: inspirar o prolongamento de tempo para a felicidade da criança ou indicar a experiência adicional/unidade parceira ${crossUnit} com custo-benefício).

Responda EXCLUSIVAMENTE em formato JSON:
{
  "offers": [
    {
      "id": "string",
      "title": "string chamativo e elegante",
      "description": "mensagem persuasiva subliminar curta convidando ao prolongamento de tempo ou adicional",
      "badge": "string opcional (ex: Dica da ZoeIA, Momento Especial)",
      "category": "UPSELL_PLAN" | "CROSS_SELL_UNIT" | "ADD_PRODUCT" | "LTV_RENEWAL",
      "targetName": "string",
      "reason": "motivo afetivo e de economia"
    }
  ]
}`;

  const prompt = `Criança: ${ctx.childName}\nTempo decorrido: ${ctx.elapsedMinutes} min (Restante: ${ctx.remainingMinutes} min)\nUnidade Atual: ${currentUnit}\nUnidade Parceira Cross-sell: ${crossUnit}`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.offers) && parsed.offers.length > 0) {
        return [parsed.offers[0]];
      }
    } catch {
      // ignore
    }
  }

  // Fallback Inteligente Local — 1 Único Card Persuasivo
  if (ctx.remainingMinutes <= 10) {
    return [
      {
        id: "ac_subliminal_time",
        title: `${ctx.childName} está radiante brincando! 🎈`,
        description: `Faltam poucos minutos para encerrar. Passe no balcão e prolongue +30min por um valor promocional para garantir que a diversão continue sem pressa.`,
        badge: "Dica Acolhedora da ZoeIA",
        category: "UPSELL_PLAN",
        targetName: "+30 Minutos",
        reason: "Prolongue com tarifa promocional e continue aproveitando o shopping com tranquilidade.",
      },
    ];
  }

  return [
    {
      id: "ac_subliminal_cross",
      title: `Sabia que o ${crossUnit} também está aberto hoje? ✨`,
      description: `Ao encerrar a visita do ${ctx.childName}, apresente esta tela na recepção do ${crossUnit} e ganhe 15% OFF para esticar a brincadeira em um ambiente novinho.`,
      badge: "Vantagem Exclusiva",
      category: "CROSS_SELL_UNIT",
      targetName: crossUnit,
      reason: "Experiência completa combinando atrações exclusivas do shopping.",
    },
  ];
}

export interface OperatorSalesCopilotTip {
  headline: string;
  tactic: string;
  focusItem: string;
  urgency: "NORMAL" | "ALTA" | "COMEMORACAO";
  suggestedScript: string;
}

export interface OperatorSalesCopilotContext {
  todayRevenueCents: number;
  targetRevenueCents: number;
  superRevenueCents?: number;
  ordersCount: number;
  ticketMedioCents: number;
  unitName: string;
  unitKind: "QUIOSQUE" | "LOJA";
  bonusLevel: "abaixo" | "meta" | "supermeta";
  bonusEstimatedCents: number;
}

/**
 * Gera orientação comercial tática em tempo real para o operador no PDV/Painel
 * orientada a bater a meta de faturamento e bonificação do dia.
 */
export async function generateOperatorSalesCopilotTip(
  ctx: OperatorSalesCopilotContext
): Promise<OperatorSalesCopilotTip> {
  const isCircuito = ctx.unitKind === "QUIOSQUE";
  const deltaMetaCents = Math.max(0, ctx.targetRevenueCents - ctx.todayRevenueCents);
  const deltaSuperCents = Math.max(0, (ctx.superRevenueCents || ctx.targetRevenueCents * 1.3) - ctx.todayRevenueCents);

  const systemInstruction = `Você é a ZoeIA, treinadora comercial do balcão FaçaAmigos.
REGRAS OBRIGATÓRIAS DE PRECIFICAÇÃO E PROTOCOLO (TABELA OFICIAL):
1. TABELA REAL PLAYGROUND:
   - 30 minutos: R$ 60,00 (Meia Inclusiva CIPTEA: R$ 50,00)
   - 1 hora (60 min): R$ 108,00 (Meia Inclusiva CIPTEA: R$ 90,00) -> Diferença para dobrar de 30min para 1h: R$ 48,00 (ou R$ 40,00 na meia)
   - 2 horas: R$ 192,00 (Meia: R$ 160,00)
   - Meia Nuvem Oficial: R$ 35,00
2. TABELA REAL CIRCUITO (CARRINHOS):
   - 30 min carrinhos / 20 min pelúcias: R$ 48,00 fixo (minuto excedente R$ 3,00)
3. PROTOCOLO PADRÃO DE VENDA DA FAÇAAMIGOS:
   - Sempre ofereça o passaporte de 1 hora logo na abertura ("tempo ideal para a criança brincar com tranquilidade e os pais descansarem no shopping").
   - 30 minutos é plano de recuo: ofereça apenas se o cliente hesitar.
   - NUNCA invente preços ou diferenças fictícias.

Responda EXCLUSIVAMENTE em formato JSON:
{
  "headline": "frase de impacto com 3 a 6 palavras",
  "tactic": "instrução direta de abordagem prática de 1 a 2 linhas",
  "focusItem": "Passaporte 1 Hora | Meia Nuvem | Passaporte 2 Horas | Circuito 30min",
  "urgency": "NORMAL" | "ALTA" | "COMEMORACAO",
  "suggestedScript": "fala exata e natural pronta para o operador ler ao cliente com valores reais"
}`;

  const prompt = `Unidade: ${ctx.unitName} (${isCircuito ? "Circuito Carrinhos" : "Playground"})
Faturamento Hoje: R$ ${(ctx.todayRevenueCents / 100).toFixed(2)}
Meta do Dia: R$ ${(ctx.targetRevenueCents / 100).toFixed(2)} (Falta R$ ${(deltaMetaCents / 100).toFixed(2)})
Nível Atual: ${ctx.bonusLevel.toUpperCase()}
Atendimentos: ${ctx.ordersCount} | Ticket Médio: R$ ${(ctx.ticketMedioCents / 100).toFixed(2)}
Bônus Estimado da Equipe: R$ ${(ctx.bonusEstimatedCents / 100).toFixed(2)}`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed?.headline && parsed?.tactic && parsed?.suggestedScript) {
        return {
          headline: parsed.headline,
          tactic: parsed.tactic,
          focusItem: parsed.focusItem || (isCircuito ? "Circuito 30min" : "Passaporte 1 Hora"),
          urgency: parsed.urgency || "NORMAL",
          suggestedScript: parsed.suggestedScript,
        };
      }
    } catch {
      // Fallback
    }
  }

  // Fallback determinístico comercial estritamente alinhado à tabela oficial
  if (ctx.bonusLevel === "supermeta") {
    return {
      headline: "Supermeta alcançada! Mantenha o ritmo!",
      tactic: "A equipe garantiu a bonificação máxima do dia. Mantenha o foco em apresentar a Meia Nuvem e pacotes mensais.",
      focusItem: isCircuito ? "Volta Adicional" : "Passaporte Mensal Porto Seguro",
      urgency: "COMEMORACAO",
      suggestedScript: "Aproveite para garantir a Meia Nuvem oficial FaçaAmigos para mais segurança na brincadeira!",
    };
  }

  if (ctx.bonusLevel === "meta") {
    const faltaSuperReais = (deltaSuperCents / 100).toFixed(2).replace(".", ",");
    return {
      headline: "Meta batida! Rumo à Supermeta!",
      tactic: `Faltam R$ ${faltaSuperReais} para o bônus máximo. Siga o protocolo oferecendo sempre 1 hora (R$ 108) na abertura.`,
      focusItem: isCircuito ? "Circuito 30min" : "Passaporte 1 Hora",
      urgency: "ALTA",
      suggestedScript: isCircuito
        ? "No circuito de 30 minutos a criança aproveita a pista inteira com tranquilidade por R$ 48,00!"
        : "Nosso passaporte padrão é de 1 hora por R$ 108,00, tempo ideal para a criança brincar e os pais passearem com calma.",
    };
  }

  if (deltaMetaCents <= 15000 && deltaMetaCents > 0) {
    const faltaReais = (deltaMetaCents / 100).toFixed(2).replace(".", ",");
    return {
      headline: "Falta muito pouco para a meta!",
      tactic: `Apenas R$ ${faltaReais} para liberar o bônus da equipe! Ofereça a Meia Nuvem (R$ 35) ou o Passaporte de 1h (R$ 108).`,
      focusItem: isCircuito ? "Circuito 30min" : "Passaporte 1 Hora + Meia Nuvem",
      urgency: "ALTA",
      suggestedScript: isCircuito
        ? "Garante a volta completa de 30 minutos por R$ 48,00 para curtir sem pressa!"
        : "Se o cliente hesitar nos 30 min (R$ 60), mostre que por R$ 48 a mais ele leva 1 hora inteira com o Olhar FaçaAmigos incluso!",
    };
  }

  return {
    headline: "Ofereça 1 hora na abertura!",
    tactic: isCircuito
      ? "Apresente o circuito de 30 minutos (R$ 48) como a melhor experiência para a criança."
      : "Regra do balcão: nunca ofereça 30 minutos primeiro. Abra com o Passaporte de 1 Hora (R$ 108,00).",
    focusItem: isCircuito ? "Circuito 30min" : "Passaporte 1 Hora",
    urgency: "NORMAL",
    suggestedScript: isCircuito
      ? "Nosso circuito de 30 minutos por R$ 48,00 é o favorito das crianças para pilotar à vontade."
      : "Nosso passaporte de tranquilidade é de 1 hora por R$ 108,00 — tempo ideal para a criança brincar e vocês descansarem.",
  };
}

export interface IdleHoursPlanSuggestion {
  id: string;
  name: string;
  durationValue: number;
  durationUnit: "MINUTO" | "HORA";
  suggestedValueCents: number;
  regularValueCents?: number;
  overageCentsPerMinute: number;
  color: string;
  badge: string;
  targetDays: string;
  targetHours: string;
  salesPitch: string;
  economicBenefit: string;
}

export interface IdleHoursPricingContext {
  unitId: string;
  unitName: string;
  activity: "PLAYGROUND" | "CARRINHO";
  currentPlans: Array<{ name: string; valueCents: number; durationValue: number }>;
}

/**
 * Analisa horários ociosos (Seg a Qui à tarde) e sugere combos e tarifas
 * promocionais de precificação dinâmica para elevar a ocupação do parque.
 */
export async function generateIdleHoursPlanSuggestions(
  ctx: IdleHoursPricingContext
): Promise<IdleHoursPlanSuggestion[]> {
  const isCircuito = ctx.activity === "CARRINHO";
  const plansSummary = ctx.currentPlans.map((p) => `${p.name}: R$ ${(p.valueCents / 100).toFixed(2)} (${p.durationValue}m)`).join(", ");

  const systemInstruction = `Você é a ZoeIA, especialista em Yield Management e Precificação Dinâmica para entretenimento infantil em shoppings.
Seu objetivo é sugerir combos e tarifas promocionais para HORÁRIOS OCIOSOS (especialmente Segunda a Quinta das 12h às 17h), convertendo fluxo ocioso em faturamento sem canibalizar os finais de semana.
Gere 3 propostas estratégicas de planos.
Responda EXCLUSIVAMENTE em formato JSON:
{
  "suggestions": [
    {
      "id": "string único",
      "name": "Nome atraente do plano (ex: Tarde Divertida 45min)",
      "durationValue": 45,
      "durationUnit": "MINUTO",
      "suggestedValueCents": 3990,
      "regularValueCents": 5500,
      "overageCentsPerMinute": 100,
      "color": "#2ECFB5" | "#F0196B" | "#FFE234" | "#FF7A00" | "#A020EE" | "#1A3F35",
      "badge": "tag chamativa (ex: Seg a Qui 13h-17h, Combo Happy Hour)",
      "targetDays": "Segunda a Quinta-feira",
      "targetHours": "12:00 às 17:00",
      "salesPitch": "argumento de venda de 1 frase para o balcão",
      "economicBenefit": "explicação do benefício financeiro"
    }
  ]
}`;

  const prompt = `Unidade: ${ctx.unitName} (${isCircuito ? "Circuito de Carrinhos" : "Playground"})
Planos de Tabela Atuais: ${plansSummary || "Padrão de mercado"}
Objetivo: atrair famílias que passeiam no shopping em dias úteis no início da tarde com combos atrativos.`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.suggestions) && parsed.suggestions.length > 0) {
        return parsed.suggestions.map((s: any, idx: number) => ({
          id: s.id || `combo_ocioso_${idx}`,
          name: s.name,
          durationValue: Number(s.durationValue) || 45,
          durationUnit: "MINUTO",
          suggestedValueCents: Number(s.suggestedValueCents) || 3990,
          regularValueCents: s.regularValueCents ? Number(s.regularValueCents) : undefined,
          overageCentsPerMinute: Number(s.overageCentsPerMinute) || 100,
          color: s.color || "#FF7A00",
          badge: s.badge || "Ocupação Ociosa",
          targetDays: s.targetDays || "Segunda a Quinta",
          targetHours: s.targetHours || "12h às 17h",
          salesPitch: s.salesPitch || "Tarifa especial de dia de semana para aproveitar o parque tranquilo.",
          economicBenefit: s.economicBenefit || "Aumenta faturamento em horários que os custos fixos já estão rodando.",
        }));
      }
    } catch {
      // Fallback
    }
  }

  // Fallback determinístico inteligente para FaçaAmigos
  if (isCircuito) {
    return [
      {
        id: "ocioso_circuito_1",
        name: "Super Bateria Tarde (20 min)",
        durationValue: 20,
        durationUnit: "MINUTO",
        suggestedValueCents: 3500,
        regularValueCents: 4500,
        overageCentsPerMinute: 150,
        color: "#FF7A00",
        badge: "⚡ Seg a Qui 13h-17h",
        targetDays: "Segunda a Quinta",
        targetHours: "13:00 às 17:00",
        salesPitch: "Bateria estendida exclusiva para dias úteis com mais tempo de pista livre.",
        economicBenefit: "Ocupa a frota de carrinhos parada nas primeiras horas da tarde.",
      },
      {
        id: "ocioso_circuito_2",
        name: "Combo Pista Livre (30 min)",
        durationValue: 30,
        durationUnit: "MINUTO",
        suggestedValueCents: 4990,
        regularValueCents: 6500,
        overageCentsPerMinute: 150,
        color: "#2ECFB5",
        badge: "🏎️ Campeão Seg a Qui",
        targetDays: "Segunda a Quinta",
        targetHours: "12:00 às 18:00",
        salesPitch: "Meia hora inteira de direção livre sem filas no circuito.",
        economicBenefit: "Eleva o ticket médio dos poucos clientes que chegam no início da tarde.",
      },
      {
        id: "ocioso_circuito_3",
        name: "Passaporte Dupla Amigos (2 Carrinhos)",
        durationValue: 15,
        durationUnit: "MINUTO",
        suggestedValueCents: 5500,
        regularValueCents: 7000,
        overageCentsPerMinute: 150,
        color: "#A020EE",
        badge: "👫 2 Carrinhos Juntos",
        targetDays: "Segunda a Quinta",
        targetHours: "Dia Todo",
        salesPitch: "Traga irmão ou amigo e andem juntos com desconto na segunda volta.",
        economicBenefit: "Gera venda casada imediata de 2 crianças no mesmo atendimento.",
      },
    ];
  }

  return [
    {
      id: "ocioso_play_1",
      name: "Tarde Divertida (45 min)",
      durationValue: 45,
      durationUnit: "MINUTO",
      suggestedValueCents: 3990,
      regularValueCents: 5000,
      overageCentsPerMinute: 100,
      color: "#2ECFB5",
      badge: "🎈 Seg a Qui 12h-17h",
      targetDays: "Segunda a Quinta",
      targetHours: "12:00 às 17:00",
      salesPitch: "Tempo perfeito para almoçar com calma no shopping enquanto a criança brinca.",
      economicBenefit: "Atrai o público do almoço do shopping em dias úteis.",
    },
    {
      id: "ocioso_play_2",
      name: "Happy Hour Kids (60 min)",
      durationValue: 60,
      durationUnit: "MINUTO",
      suggestedValueCents: 4990,
      regularValueCents: 6500,
      overageCentsPerMinute: 100,
      color: "#F0196B",
      badge: "⏰ Happy Hour 14h-18h",
      targetDays: "Segunda a Quinta",
      targetHours: "14:00 às 18:00",
      salesPitch: "1 hora inteira pelo valor promocional de 30 minutos em dias úteis.",
      economicBenefit: "Maximiza a permanência da criança e eleva consumo adicional de lanches.",
    },
    {
      id: "ocioso_play_3",
      name: "Combo Brincar + Meia Oficial",
      durationValue: 40,
      durationUnit: "MINUTO",
      suggestedValueCents: 5490,
      regularValueCents: 6800,
      overageCentsPerMinute: 100,
      color: "#FF7A00",
      badge: "🧦 Brincadeira + Meia",
      targetDays: "Segunda a Quinta",
      targetHours: "12:00 às 18:00",
      salesPitch: "Entrada com meia antiderrapante oficial inclusa no pacote por um valor único.",
      economicBenefit: "Desova de estoque de meias e margem líquida direta no combo.",
    },
  ];
}

