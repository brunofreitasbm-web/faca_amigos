import { createClient } from "jsr:@supabase/supabase-js@2";

// Function ADMINISTRATIVA, de uso único (não é chamada por cron nem pela
// SPA): cria no Twilio Content API os templates de WhatsApp que faltam para
// o catálogo inteiro do CRM e submete cada um para aprovação da Meta. Usa as
// MESMAS credenciais (TWILIO_CRM_ACCOUNT_SID/TWILIO_CRM_AUTH_TOKEN) que as
// demais Edge Functions do CRM já usam para enviar mensagem — nenhuma
// credencial nova.
//
// Idempotente: para cada purpose, se já existe uma linha em fa_crm_templates
// com content_sid, não recria — só confere o status de aprovação e ativa
// (active=true) se a Meta já aprovou. Nunca ativa sozinho um template que a
// Meta ainda não aprovou ou recusou.
//
// Aprovação da Meta é ASSÍNCRONA (até 24h) e fora do nosso controle — esta
// function só SUBMETE; rodar de novo mais tarde reflete o status atualizado.

const CONTENT_API = "https://content.twilio.com/v1/Content";

interface TemplateDef {
  purpose: string;
  name: string; // friendly_name no Twilio: só minúsculas, números e "_"
  body: string;
  category: "UTILITY" | "MARKETING";
  variableCount: number;
  sample: Record<string, string>;
  quickReplyButtons?: { title: string; id: string }[];
  /** Botão de link (twilio/call-to-action). A variável de URL é o sufixo `{{n}}` no fim da url. */
  urlButton?: { title: string; url: string };
}

// Corpo provisório, alinhado ao design e às variáveis que cada Edge Function
// já envia (ver crm-renewal-alert-dispatch, crm-visit-notify-dispatch,
// crm-mapeamento-dispatch, session-report-dispatch, crm-lifecycle-dispatch).
// TEXTO CARECE DE REVISÃO/APROVAÇÃO DE NEGÓCIO antes de considerar definitivo
// — publicado para destravar o cadastro e a submissão à Meta.
const TEMPLATES: TemplateDef[] = [
  // Estes dois já tinham content_sid real de antes desta rodada — entram
  // aqui só para a submissão de aprovação encontrar nome/categoria (não
  // recriam o conteúdo, purpose já existe em fa_crm_templates).
  {
    purpose: "NPS", name: "fa_nps_pos_visita", category: "UTILITY", variableCount: 1,
    body: "Olá {{1}}! Como foi sua visita ao FaçaAmigos? De 0 a 10, o quanto você nos recomendaria a um amigo? Responda só com o número. 💛",
    sample: { "1": "Ana" },
  },
  {
    purpose: "OPTIN", name: "fa_pedido_autorizacao", category: "UTILITY", variableCount: 1,
    body: "Olá, {{1}}! Aqui é o FaçaAmigos, onde seu filho brincou. Podemos te avisar por aqui sobre as visitas e enviar uma pesquisa rápida de satisfação? Responda SIM para aceitar ou PARAR para não receber mensagens.",
    sample: { "1": "Ana" },
  },
  {
    purpose: "RENOVACAO", name: "fa_renovacao_fim_plano", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! O tempo de {{2}} termina em poucos minutos. Para continuar sem pressa: {{3}}. Toque na opção desejada.",
    sample: { "1": "Ana", "2": "Miguel", "3": "1) +15 min por R$ 30,00 · 2) +30 min por R$ 48,00 · 3) +60 min por R$ 96,00" },
    quickReplyButtons: [{ title: "Opção 1", id: "RENOVAR_1" }, { title: "Opção 2", id: "RENOVAR_2" }, { title: "Opção 3", id: "RENOVAR_3" }],
  },
  {
    purpose: "VISITA_BOAS_VINDAS", name: "fa_visita_boas_vindas", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! {{2}} já está brincando com a gente 💛 Acompanhe o tempo por aqui: {{3}} Qualquer coisa, é só chamar.",
    sample: { "1": "Ana", "2": "Miguel", "3": "https://app.institutofacaamigos.com.br/?acompanhar=ABC123" },
  },
  {
    purpose: "VISITA_EXCEDENTE", name: "fa_visita_excedente", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! O tempo do plano de {{2}} terminou. Se quiser que ela(e) continue brincando, cada minuto adicional custa {{3}}. Fale com a nossa equipe no balcão. 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "R$ 3,00" },
  },
  {
    purpose: "VISITA_RENOVACAO_OK", name: "fa_visita_renovacao_ok", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! Tudo certo: acrescentamos {{3}} ao tempo de {{2}}. Boa diversão! 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "+30 min" },
  },
  {
    purpose: "VISITA_FIDELIDADE", name: "fa_visita_fidelidade_v2", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}, tudo bem? Aqui é o FaçaAmigos com uma novidade sobre o cartão fidelidade de {{2}}: {{3}} Cada visita conta e a gente adora ver vocês por aqui. Qualquer dúvida, é só responder esta mensagem. 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "Miguel está a só 2 visitas de ganhar 30 min de cortesia! Continue vindo brincar." },
  },
  {
    purpose: "RELATORIO_SESSAO", name: "fa_relatorio_sessao_v3", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}, tudo bem? Aqui é a equipe do FaçaAmigos com o Olhar FaçaAmigos de hoje sobre {{2}}. Nossa equipe acompanhou cada momento da brincadeira e separou este recado para você: {{3}} É um registro observacional da brincadeira, sem caráter de avaliação. Qualquer dúvida, é só responder esta mensagem. Até a próxima visita! 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "Hoje Miguel passou 90 minutos com a gente e brilhou na coordenação motora e na interação social." },
  },
  {
    // Olhar FaçaAmigos em PDF: 1 destaque + botão que abre o documento
    // (session-report-view?t=<token>). Numeração única entre corpo e botão.
    purpose: "RELATORIO_SESSAO_PDF", name: "fa_relatorio_sessao_pdf_v2", category: "UTILITY", variableCount: 4,
    body: "Oi {{1}}, tudo bem? Aqui é a equipe do FaçaAmigos com o Olhar FaçaAmigos de hoje sobre {{2}}. Um destaque: {{3}} O documento completo, com o que a nossa equipe viu enquanto {{2}} brincava, está no botão abaixo. É um registro observacional da brincadeira, sem caráter de avaliação. Qualquer dúvida, é só responder esta mensagem. 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "Miguel brilhou ao dividir os brinquedos e entrar no faz de conta com as outras crianças!", "4": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG" },
    urlButton: { title: "Abrir Olhar", url: "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/session-report-view?t={{4}}" },
  },
  {
    purpose: "MAPEAMENTO", name: "fa_mapeamento_followup", category: "MARKETING", variableCount: 4,
    body: "Oi {{1}}! Faz uma semana que {{2}} brincou com a gente 💛 {{3}} O FaçaAmigos existe para que toda criança aprenda a fazer amigos, se expressar e crescer com segurança. E isso começa por entender como ela é. Por isso criamos o Mapeamento Comportamental: 5 minutos de perguntas e um direcionamento gratuito, feito por psicólogas. Faça aqui: {{4}} Se quiser conversar sobre o resultado, é só responder esta mensagem.",
    sample: { "1": "Ana", "2": "Miguel", "3": "Nessa fase, entender como Miguel se comunica e reage ao mundo faz toda diferença.", "4": "https://institutofacaamigos.com.br/teste" },
  },
  {
    purpose: "EXPIRACAO", name: "fa_lc_expiracao", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! O saldo de {{2}} {{3}}. Passa aqui pra garantir mais diversão! 💛",
    sample: { "1": "Ana", "2": "pacote", "3": "restam 20 min" },
  },
  {
    purpose: "RELATORIO_CUPOM", name: "fa_lc_relatorio_cupom", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! Esperamos que {{2}} tenha se divertido hoje 💛 Como agradecimento, {{3}}. Esperamos vocês de novo em breve!",
    sample: { "1": "Ana", "2": "Miguel", "3": "10% de desconto na próxima visita em até 14 dias" },
  },
  {
    purpose: "PREMIO_FIDELIDADE", name: "fa_lc_premio_fidelidade", category: "UTILITY", variableCount: 2,
    body: "Oi {{1}}! Lembrando que {{2}} ainda tem um prêmio de fidelidade esperando pra ser resgatado na próxima visita. Não deixe vencer! 💛",
    sample: { "1": "Ana", "2": "Miguel" },
  },
  {
    purpose: "NPS_PROMOTOR", name: "fa_lc_nps_promotor", category: "UTILITY", variableCount: 2,
    body: "Que alegria, {{1}}! Ficaríamos muito felizes se você deixasse uma avaliação rápida pra gente no Google: {{2}} 💛",
    sample: { "1": "Ana", "2": "https://g.page/r/review" },
  },
  {
    purpose: "NPS_DETRATOR", name: "fa_lc_nps_detrator", category: "UTILITY", variableCount: 1,
    body: "Oi {{1}}, obrigado pelo retorno. Sentimos muito que a experiência não tenha sido a melhor. Nossa gerência vai entrar em contato pra entender melhor e te ajudar. 💛",
    sample: { "1": "Ana" },
  },
  {
    purpose: "UPSELL_PACOTE", name: "fa_lc_upsell_pacote", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! {{2}} adorou a visita 💛 Que tal conhecer nossos pacotes e economizar nas próximas idas? Fale com a equipe no balcão ou responda aqui.",
    sample: { "1": "Ana", "2": "Miguel" },
  },
  {
    purpose: "CROSS_ATIVIDADE", name: "fa_lc_cross_atividade", category: "MARKETING", variableCount: 3,
    body: "Oi {{1}}! {{2}} já manda bem por aqui — que tal conhecer o {{3}} também? Uma experiência diferente esperando por vocês. 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "Circuito" },
  },
  {
    purpose: "CROSS_IRMAO", name: "fa_lc_cross_irmao", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! {{2}} sempre se diverte muito aqui — que tal trazer o irmãozinho(a) também na próxima visita? 💛",
    sample: { "1": "Ana", "2": "Miguel" },
  },
  {
    purpose: "ANIVERSARIO", name: "fa_lc_aniversario", category: "MARKETING", variableCount: 2,
    body: "Parabéns pra {{2}}, {{1}}! 🎉 Que tal comemorar o aniversário brincando com a gente? Preparamos algo especial pra essa data. 💛",
    sample: { "1": "Ana", "2": "Miguel" },
  },
  {
    purpose: "VIP", name: "fa_lc_vip", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! {{2}} está entre nossos visitantes mais fiéis 💛 Como reconhecimento, você agora tem prioridade no pré-check-in. Obrigado por confiar na gente!",
    sample: { "1": "Ana", "2": "Miguel" },
  },
  {
    purpose: "WINBACK", name: "fa_lc_winback", category: "MARKETING", variableCount: 1,
    body: "Sentimos sua falta, {{1}}! 💛 Faz um tempo que vocês não aparecem por aqui. Que tal marcar uma nova visita? Estamos te esperando.",
    sample: { "1": "Ana" },
  },
  {
    purpose: "OPTIN_MARKETING", name: "fa_optin_marketing", category: "MARKETING", variableCount: 1,
    body: "Oi {{1}}! Além dos avisos da visita, quer também receber de vez em quando nossas ofertas e novidades (pacotes, promoções)? Responda SIM para aceitar ou PARAR para não receber mais mensagens.",
    sample: { "1": "Ana" },
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: existing } = await admin.from("fa_crm_templates").select("id, purpose, content_sid, active");
  const byPurpose = new Map((existing ?? []).map((t) => [t.purpose, t]));

  const results: Record<string, unknown>[] = [];

  // ── 1. Purposes já com content_sid real: confere aprovação; se nunca foi
  //      submetido (fetch não devolve status), submete agora. ──
  const defByPurpose = new Map(TEMPLATES.map((d) => [d.purpose, d]));
  for (const row of existing ?? []) {
    if (row.active || !row.content_sid) continue;
    try {
      const fetchRes = await fetch(`${CONTENT_API}/${row.content_sid}/ApprovalRequests`, { headers: { Authorization: auth } });
      const out = await fetchRes.json().catch(() => ({}));
      const status = (out?.whatsapp?.status ?? out?.status) as string | undefined;

      const st = status ? String(status).toLowerCase() : null;
      if (st === "approved") {
        await admin.from("fa_crm_templates").update({ active: true }).eq("id", row.id);
        results.push({ purpose: row.purpose, action: "ativado (já aprovado pela Meta)", contentSid: row.content_sid });
        continue;
      }
      if (st === "pending" || st === "rejected") {
        results.push({ purpose: row.purpose, action: "aguardando aprovação", status, contentSid: row.content_sid });
        continue;
      }

      // "unsubmitted"/"received"/ausente: a submissão de aprovação de fato
      // ainda não foi feita. Submete agora, se tivermos a definição
      // (categoria) deste purpose.
      const def = defByPurpose.get(row.purpose);
      if (!def) {
        results.push({ purpose: row.purpose, action: "sem definição local para submeter — cadastrar manualmente", contentSid: row.content_sid });
        continue;
      }
      const approvalRes = await fetch(`${CONTENT_API}/${row.content_sid}/ApprovalRequests/whatsapp`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: def.name, category: def.category }),
      });
      const approval = await approvalRes.json().catch(() => ({}));
      results.push({
        purpose: row.purpose,
        action: approvalRes.ok ? "submetido à Meta agora" : "falha ao submeter aprovação",
        httpStatus: approvalRes.status,
        contentSid: row.content_sid,
        approvalStatus: approval?.status ?? approval,
      });
    } catch (e) {
      results.push({ purpose: row.purpose, action: "erro ao checar/submeter aprovação", error: String(e) });
    }
  }

  // ── 2. Purposes sem template: cria + submete para aprovação. ──
  for (const def of TEMPLATES) {
    if (byPurpose.has(def.purpose)) continue;

    const types = def.quickReplyButtons
      ? { "twilio/quick-reply": { body: def.body, actions: def.quickReplyButtons } }
      : def.urlButton
        ? { "twilio/call-to-action": { body: def.body, actions: [{ type: "URL", title: def.urlButton.title, url: def.urlButton.url }] } }
        : { "twilio/text": { body: def.body } };

    const createRes = await fetch(CONTENT_API, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ friendly_name: def.name, language: "pt_BR", types, variables: def.sample }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !created.sid) {
      results.push({ purpose: def.purpose, action: "falha ao criar", status: createRes.status, error: created?.message ?? created });
      continue;
    }
    const contentSid: string = created.sid;

    const approvalRes = await fetch(`${CONTENT_API}/${contentSid}/ApprovalRequests/whatsapp`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: def.name, category: def.category }),
    });
    const approval = await approvalRes.json().catch(() => ({}));
    const submitted = approvalRes.ok;

    await admin.from("fa_crm_templates").insert({
      name: def.name,
      content_sid: contentSid,
      preview: def.body,
      variable_count: def.variableCount,
      purpose: def.purpose,
      active: false, // só ativa quando a Meta aprovar (rodar esta function de novo depois confere e ativa)
    });

    results.push({
      purpose: def.purpose,
      action: submitted ? "criado e submetido à Meta" : "criado, mas falha ao submeter aprovação",
      contentSid,
      approvalStatus: approval?.status ?? approval,
    });
  }

  return json({ ok: true, results });
});
