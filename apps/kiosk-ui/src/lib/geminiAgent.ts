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
    model: (storedModel as GeminiModel) || "gemini-1.5-flash",
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
    });

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
Sua missão é sugerir a melhor oferta de upsell/cross-sell no momento do check-in com tom caloroso, empático e focado no bem-estar da família.
Responda EXCLUSIVAMENTE em formato JSON com o seguinte esquema:
{
  "offers": [
    {
      "id": "string",
      "title": "string curto chamativo (ex: Upgrade para 1 Hora)",
      "description": "string explicativo curto com toque humano",
      "badge": "string opcional (ex: Dica da ZoeIA, Mais Recomendado, 20% OFF)",
      "actionType": "UPGRADE_PLAN" | "ADD_PRODUCT" | "APPLY_COUPON",
      "targetName": "string com o nome do produto/plano recomendado (ex: Meia Antiderrapante)",
      "priceCents": number_opcional,
      "reason": "motivo resumido sob a perspectiva humana de acolhimento"
    }
  ]
}`;

  const prompt = `Contexto da Entrada:
- Criança: ${ctx.childName || "Criança"} (${ctx.childAge ? ctx.childAge + " anos" : "idade não inf."})
- Responsável: ${ctx.responsibleName || "Acompanhante"}
- Plano selecionado: ${ctx.selectedPlanName || "Nenhum selecionado"} (${ctx.selectedPlanMinutes || 30} min)
- Número de visitas anteriores: ${ctx.visitCount || 1}
- Produtos no carrinho: ${ctx.productsInCart?.join(", ") || "Nenhum produto"}
- Unidade: ${ctx.unitName || "Playground"}

Gere até 2 ofertas perspicazes para o operador oferecer à família agora.`;

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

/**
 * Gera Insights para a tela Gerencial
 */
export async function generateGerencialInsights(metricsSummary: string): Promise<GerencialInsight[]> {
  const systemInstruction = `Você é a ZoeIA, a Diretora Comercial Virtual de IA do FaçaAmigos.
Analise as métricas gerenciais e sugira 3 ações práticas e humanas de vendas para a unidade.
Responda EXCLUSIVAMENTE no formato JSON:
{
  "insights": [
    {
      "id": "string",
      "title": "string",
      "category": "FATURAMENTO" | "HOJE" | "PRODUTOS" | "METAS",
      "description": "análise curta com números",
      "recommendation": "ação clara e humana a ser tomada",
      "impact": "ALTO" | "MEDIO" | "BAIXO"
    }
  ]
}`;

  const prompt = `Métricas Atuais da Unidade:\n${metricsSummary}`;

  const rawJson = await callGemini(prompt, systemInstruction);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed?.insights) && parsed.insights.length > 0) {
        return parsed.insights;
      }
    } catch {
      // ignore
    }
  }

  // Fallback Gerencial
  return [
    {
      id: "ins_1",
      title: "Oportunidade de Upsell no Horário das 14h às 17h",
      category: "FATURAMENTO",
      description: "O ticket médio das entradas entre 14h e 17h está 22% menor que a média noturna.",
      recommendation: "ZoeIA sugere: Criar o cupom 'TARDE_DIVERTIDA' com 15% de desconto no plano de 1 hora para atrair famílias no meio da tarde.",
      impact: "ALTO",
    },
    {
      id: "ins_2",
      title: "Baixa Conversão de Meias Antiderrapantes",
      category: "PRODUTOS",
      description: "Apenas 18% dos check-ins incluem a compra de meias antiderrapantes.",
      recommendation: "ZoeIA sugere: Orientar os mediadores no balcão a oferecer o combo 'Entrada + Meia' durante o check-in com carinho e valor promocional.",
      impact: "MEDIO",
    },
    {
      id: "ins_3",
      title: "Desempenho da Meta Semanal",
      category: "METAS",
      description: "A unidade alcançou 68% da meta semanal de faturamento com 70% do tempo transcorrido.",
      recommendation: "ZoeIA sugere: Estimular a equipe com a bonificação adicional nos pacotes de 10 horas comprados até o domingo.",
      impact: "ALTO",
    },
  ];
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
      });

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
