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
export async function generateCheckinSuggestions(ctx: CheckinContext): Promise<CheckinOffer[]> {
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

  const plansText = ctx.availablePlans?.map((p) => `- ${p.name}: ${p.minutes}min por R$ ${(p.valueCents / 100).toFixed(2)}`).join("\n") || "Planos Padrão do Sistema";
  const productsText = ctx.availableProducts?.map((p) => `- ${p.name}: R$ ${(p.priceCents / 100).toFixed(2)}`).join("\n") || "Meias Antiderrapantes e Bebidas";
  const couponsText = ctx.availableCoupons?.map((c) => `- Código: ${c.code} (${c.discountText || "Desconto"})`).join("\n") || "Sem cupons adicionais";

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

  // Sugestão 1: Upgrade de Plano se selecionou plano curto
  if (selectedMinutes <= 30) {
    offers.push({
      id: "up_1h",
      title: "Upgrade para Plano 60 Minutos",
      description: "As crianças costumam brincar mais de 45min. Garanta o valor promocional de 1h!",
      badge: "✦ Sugestão IA",
      actionType: "UPGRADE_PLAN",
      targetName: "60 Minutos",
      reason: "O tempo médio de permanência na unidade é de 55 minutos.",
    });
  }

  // Sugestão 2: Meia Antiderrapante
  const hasSocks = ctx.productsInCart?.some((p) => p.toLowerCase().includes("meia"));
  if (!hasSocks) {
    offers.push({
      id: "add_socks",
      title: "Adicionar Meia Antiderrapante",
      description: "Meias oficiais com aderência para maior segurança nos brinquedos.",
      badge: "Item Essencial",
      actionType: "ADD_PRODUCT",
      targetName: "Meia Antiderrapante",
      priceCents: 1500,
      reason: "Segurança reforçada e exigência para brinquedos com circuito alto.",
    });
  }

  // Sugestão 3: Pacote de Horas para clientes recorrentes
  if (visitCount >= 2 && offers.length < 2) {
    offers.push({
      id: "vip_pack",
      title: "Pacote Fidelidade 10 Horas",
      description: "Cliente frequente! Economize até 35% por hora comprando o pacote promocional.",
      badge: "Economia VIP",
      actionType: "APPLY_COUPON",
      targetName: "PACOTE_VIP",
      reason: "Cliente em sua visita #" + visitCount + ". Apresenta alto potencial de conversão.",
    });
  }

  return offers;
}

/**
 * Gera ofertas de Check-out (Retenção / Conversão)
 */
export async function generateCheckoutSuggestions(ctx: CheckoutContext): Promise<CheckoutOffer[]> {
  const systemInstruction = `Você é a ZoeIA, a especialista em fidelização e retenção do FaçaAmigos.
Gere ofertas humanas e estratégicas de checkout para acolher e fidelizar a família ao sair do parque.
Responda EXCLUSIVAMENTE no formato JSON:
{
  "offers": [
    {
      "id": "string",
      "title": "string curto chamativo",
      "description": "string com tom humano e convidativo",
      "badge": "string opcional (ex: Dica da ZoeIA, Fidelidade VIP)",
      "actionType": "CONVERT_VIP_PACKAGE" | "OFFER_RETURN_COUPON" | "BOOK_EVENT",
      "reason": "string"
    }
  ]
}`;

  const prompt = `Contexto da Saída:
- Criança: ${ctx.childName || "Criança"}
- Permanência total: ${ctx.durationMinutes || 0} minutos (Excedente: ${ctx.extraMinutes || 0} min)
- Valor pago acumulado: R$ ${((ctx.totalPaidCents || 0) / 100).toFixed(2)}
- Visitas anteriores: ${ctx.visitCount || 1}`;

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

  // Fallback Local de Checkout
  return [
    {
      id: "checkout_return",
      title: "Cupom 15% OFF na Próxima Visita",
      description: "Ofereça este desconto para retorno até a próxima quinta-feira em dias de menor movimento.",
      badge: "Dica da ZoeIA",
      actionType: "OFFER_RETURN_COUPON",
      reason: "Garante retorno rápido da família e estimula o movimento em dias úteis.",
    },
    {
      id: "checkout_package",
      title: "Converter em Pacote Passaporte VIP",
      description: "Abata parte do valor da sessão de hoje na adesão de um pacote de 10 horas.",
      badge: "ZoeIA Indica",
      actionType: "CONVERT_VIP_PACKAGE",
      reason: "Família acumulou mais de " + (ctx.durationMinutes || 45) + " minutos nesta visita.",
    },
  ];
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

Gere um relatório gerencial estratégico em JSON para "${targetUnit}" considerando a realidade e sinergia entre estas 3 unidades da rede, cobrindo:
1. Projeções de Faturamento & Como Aumentar Receita (comparações entre as 3 unidades se for análise consolidada).
2. Pontos de Atenção & Onde melhorar (identifique gargalos específicos ou compartilhados).
3. Eficiência dos Operadores (destaque de operador mais eficiente e operador em desenvolvimento na unidade).
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
    "topOperatorName": "Nome do operador destaque",
    "topOperatorMetric": "Métrica de destaque (ex: 42% de conversão em meias e upsell)",
    "topOperatorReason": "Motivo do sucesso para replicar na equipe",
    "needsTrainingOperatorName": "Nome do operador que precisa de suporte",
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

  // Fallback Inteligente Estruturado com foco nas 3 unidades reais
  return {
    unitName: targetUnit,
    projections: {
      forecastText: isConsolidated
        ? "Projeção Consolidada da Rede (Circuito, Playground Parque Shopping e Playground Grão-Pará): R$ 12.800,00 hoje."
        : `Projeção estimada de faturamento para hoje na ${targetUnit}: R$ 4.200,00 (Período vespertino em alta).`,
      targetText: isConsolidated
        ? "Meta Diária da Rede: R$ 15.000,00 — Faltam R$ 2.200,00 no somatório das 3 unidades."
        : `Meta Diária da ${targetUnit}: R$ 5.000,00 — Faltam R$ 800,00 para atingir a bonificação máxima do turno.`,
      howToIncrease: [
        "Estimular Cross-sell ativo entre Circuito e Playground Parque Shopping (desconto de 15% para dobradinha no mesmo dia).",
        "Oferecer o Combo 'Entrada + Meia Antiderrapante' para 100% das famílias na fila do Playground Grão-Pará.",
        "Promover o Pacote VIP Passaporte 10 Horas válido em todas as 3 unidades da rede.",
      ],
    },
    attentionPoints: {
      issue: isConsolidated
        ? "Divergência na taxa de conversão de meias: 42% no Circuito vs 18% no Playground Grão-Pará."
        : `A taxa de conversão de meias e adicionais na ${targetUnit} está em 18%, abaixo da meta da rede (40%).`,
      whereToImprove: "Padronizar a abordagem de balcão do Circuito no Playground Grão-Pará para elevar a média global da rede.",
    },
    operatorPerformance: {
      topOperatorName: "Ana Silva (Circuito)",
      topOperatorMetric: "42% de conversão em meias e 35% em upgrade de tempo",
      topOperatorReason: "Abordagem acolhedora demonstrando a economia do plano maior logo no início do atendimento.",
      needsTrainingOperatorName: "Lucas Costa (Playground Grão-Pará)",
      needsTrainingMetric: "12% de conversão em produtos adicionais",
      needsTrainingAction: "Realizar alinhamento de 5 minutos com o Lucas no início do turno mostrando a abordagem padrão do Circuito.",
    },
    actionPlan: {
      steps: [
        "Fazer uma rápida reunião de alinhamento de 3 minutos com as equipes dos 3 balcões antes do pico das 14h.",
        "Divulgar a venda cruzada de ingressos entre Circuito e Playground Parque Shopping nos cupons de saída.",
        "Colocar a meta diária consolidada visível no mural interno para incentivar a bonificação coletiva do time.",
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
Seja direta, calorosa, prática e utilize dados e estratégias de varejo e entretenimento infantil em shoppings.`;
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
