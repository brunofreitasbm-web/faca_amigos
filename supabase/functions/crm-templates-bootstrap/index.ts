import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseScope } from "./scope.ts";

// Function ADMINISTRATIVA, de uso único (não é chamada por cron nem pela
// SPA): cria no Twilio Content API os templates de WhatsApp que faltam para
// o catálogo inteiro do CRM e submete cada um para aprovação da Meta. Usa as
// MESMAS credenciais (TWILIO_CRM_ACCOUNT_SID/TWILIO_CRM_AUTH_TOKEN) que as
// demais Edge Functions do CRM já usam para enviar mensagem — nenhuma
// credencial nova.
//
// Idempotente: para cada template (por nome), se já existe uma linha em
// fa_crm_templates com content_sid, não recria — só confere o status de aprovação e ativa
// (active=true) se a Meta já aprovou. Nunca ativa sozinho um template que a
// Meta ainda não aprovou ou recusou.
//
// Aprovação da Meta é ASSÍNCRONA (até 24h) e fora do nosso controle — esta
// function só SUBMETE; rodar de novo mais tarde reflete o status atualizado.
//
// Escopo (ver ./scope.ts): sem corpo trata o catálogo inteiro; com
// {"names": ["fa_nps_pos_visita_v2"]} trata só esses; {"dryRun": true} só
// mostra o que faria, sem tocar na Twilio, na Meta nem no banco.

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
// Botões das ofertas da régua: o payload volta em ButtonPayload no webhook.
const OFFER_BUTTONS = [{ title: "Quero saber mais", id: "OFERTA_INFO" }, { title: "Agora não", id: "OFERTA_NAO" }];

// Templates substituídos por uma versão nova ou retirados de uso: nunca
// reativados aqui, mesmo que a Meta os tenha aprovado (as migrations
// 20261001130000 e 20261001140000 os desativaram).
const RETIRED = new Set(["fa_lc_upsell_pacote", "fa_lc_cross_atividade", "fa_lc_vip", "fa_lc_winback", "fa_lc_nps_promotor", "fa_renovacao_fim_plano", "fa_nps_pos_visita_v2"]);

const TEMPLATES: TemplateDef[] = [
  // Estes dois já tinham content_sid real de antes desta rodada — entram
  // aqui só para a submissão de aprovação encontrar nome/categoria (não
  // recriam o conteúdo, purpose já existe em fa_crm_templates).
  {
    purpose: "NPS", name: "fa_nps_pos_visita", category: "UTILITY", variableCount: 1,
    body: "Olá {{1}}! Como foi sua visita ao FaçaAmigos? De 0 a 10, o quanto você nos recomendaria a um amigo? Responda só com o número. 💛",
    sample: { "1": "Ana" },
  },
  // NPS em etapas dentro do WhatsApp: este template só pergunta a UNIDADE
  // (resposta = número da lista em {{2}}); o resto das perguntas sai como
  // mensagem livre, dentro da janela aberta pela resposta (ver
  // _shared/nps.ts e crm-whatsapp-webhook). Ao ser aprovado e ativado, vira o
  // template NPS mais novo e passa a ser o usado no envio. O v1 acima NÃO
  // entra em RETIRED até a Meta aprovar este.
  {
    purpose: "NPS", name: "fa_nps_pos_visita_v2", category: "UTILITY", variableCount: 2,
    body: "Olá {{1}}! Queremos saber como foi a sua visita ao FaçaAmigos, são só algumas perguntas rápidas. Primeiro: em qual unidade você esteve? Responda só com o número: {{2}} 💛",
    sample: { "1": "Ana", "2": "1) Playground Parque Shopping · 2) Circuito Parque Shopping · 3) Playground Bosque Grão-Pará" },
  },
  {
    purpose: "OPTIN", name: "fa_pedido_autorizacao", category: "UTILITY", variableCount: 1,
    body: "Olá, {{1}}! Aqui é o FaçaAmigos, onde seu filho brincou. Podemos te avisar por aqui sobre as visitas e enviar uma pesquisa rápida de satisfação? Responda SIM para aceitar ou PARAR para não receber mensagens.",
    sample: { "1": "Ana" },
  },
  // v1 foi recategorizada como MARKETING pela Meta (erro 63049 em quem já
  // atingiu o limite de marketing): "pesquisa de satisfação" no texto puxa essa
  // categoria. v2 pede a autorização só para o que é da visita (relatório e
  // avisos), sem pesquisa nem tom promocional, para ser aceita como UTILITY.
  // A Meta decide a categoria pelo conteúdo: conferir o resultado depois de aprovada.
  {
    purpose: "OPTIN", name: "fa_pedido_autorizacao_v2", category: "UTILITY", variableCount: 1,
    body: "Olá, {{1}}! Aqui é o FaçaAmigos. Para te enviar por aqui o relatório e os avisos da visita do seu filho, precisamos da sua autorização. Responda SIM para autorizar ou PARAR para não receber mensagens.",
    sample: { "1": "Ana" },
  },
  // v2: só 2 botões (+30 e +60 min do Playground). A v1 tinha 3 botões
  // ("Opção 1/2/3") e o 3º ficaria morto. Preços vão na variável {{3}}, não nos
  // botões, para mudar a tabela sem reaprovar o template.
  {
    purpose: "RENOVACAO", name: "fa_renovacao_fim_plano_v2", category: "UTILITY", variableCount: 3,
    body: "Oi {{1}}! O tempo de {{2}} termina em poucos minutos. Para continuar sem pressa: {{3}}. Toque na opção desejada.",
    sample: { "1": "Ana", "2": "Miguel", "3": "+30 min por R$ 48,00 ou +60 min por R$ 96,00" },
    quickReplyButtons: [{ title: "+30 min", id: "RENOVAR_1" }, { title: "+60 min", id: "RENOVAR_2" }],
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
    // v2: o aviso de excedente ganha o botão SIM, que renova o plano atual no
    // balcão (fa_crm_overage_renew). A v1 segue ativa até a Meta aprovar esta.
    purpose: "VISITA_EXCEDENTE", name: "fa_visita_excedente_v2", category: "UTILITY", variableCount: 5,
    body: "Oi {{1}}! O tempo do plano de {{2}} terminou. Se quiser que ela(e) continue brincando, cada minuto adicional custa {{3}}. Se quiser renovar o plano atual ({{4}} por {{5}}) e não pagar por minutos excedentes, clique em SIM. 💛",
    sample: { "1": "Ana", "2": "Miguel", "3": "R$ 3,00", "4": "1 hora", "5": "R$ 96,00" },
    quickReplyButtons: [{ title: "SIM", id: "RENOVAR_ATUAL" }],
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
    purpose: "NPS_DETRATOR", name: "fa_lc_nps_detrator", category: "UTILITY", variableCount: 1,
    body: "Oi {{1}}, obrigado pelo retorno. Sentimos muito que a experiência não tenha sido a melhor. Nossa gerência vai entrar em contato pra entender melhor e te ajudar. 💛",
    sample: { "1": "Ana" },
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
  // ── Régua de ofertas (migration 20261001130000): produtos maiores, sem
  //    desconto, com botões "Quero saber mais" / "Agora não" tratados pelo
  //    crm-whatsapp-webhook. Substituem fa_lc_upsell_pacote e as v1 de
  //    CROSS_ATIVIDADE, VIP e WINBACK (ver RETIRED). ──
  {
    purpose: "DEGRAU_2H", name: "fa_oferta_degrau_2h", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! Vimos que {{2}} ficou com gostinho de quero mais na última visita 😄 Com o plano de 2 horas dá tempo de vocês almoçarem ou fazerem as compras no shopping sem ficar de olho no relógio. Toque abaixo pra ver como funciona.",
    sample: { "1": "Ana", "2": "Miguel" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "DEGRAU_PORTO", name: "fa_oferta_porto_seguro", category: "MARKETING", variableCount: 3,
    body: "Oi {{1}}! {{2}} já veio {{3}} vezes este mês 💛 Pra famílias que vêm sempre, temos o Porto Seguro: 10 horas pra usar em 30 dias, no dia e no horário que quiserem, e os irmãos usam o mesmo saldo. Sem fila no caixa a cada visita.",
    sample: { "1": "Ana", "2": "Miguel", "3": "4" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "DEGRAU_DAYUSE", name: "fa_oferta_day_use", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! Fim de semana chegando: com o Day Use, {{2}} brinca o dia inteiro, vocês saem pra almoçar ou passear no shopping e voltam quando quiserem, sem contar minuto. Toque abaixo pra saber como reservar.",
    sample: { "1": "Ana", "2": "Miguel" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "CROSS_ATIVIDADE", name: "fa_oferta_cross_atividade_v2", category: "MARKETING", variableCount: 4,
    body: "Oi {{1}}! {{2}} já é de casa por aqui, mas ainda não conhece {{3}}: {{4}}. Fica no Parque Shopping, pertinho de onde vocês já brincam. Toque abaixo pra saber como funciona.",
    sample: { "1": "Ana", "2": "Miguel", "3": "o Circuito", "4": "carrinhos elétricos, motos e pelúcias motorizadas pra pilotar" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "VIP", name: "fa_oferta_vip_v2", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! {{2}} está entre as crianças que mais brincam com a gente 💛 Pra famílias como a de vocês, o Porto Seguro costuma valer mais: 10 horas em 30 dias, entra e sai, irmãos juntos. Toque abaixo e te explicamos.",
    sample: { "1": "Ana", "2": "Miguel" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "WINBACK", name: "fa_oferta_winback_v2", category: "MARKETING", variableCount: 2,
    body: "Oi {{1}}! Faz um tempinho que {{2}} não vem brincar 💛 Desde a última visita, nossa equipe passou a enviar o Olhar FaçaAmigos: um recado sobre como cada criança brincou, interagiu e se expressou. Na próxima visita, {{2}} já recebe o seu.",
    sample: { "1": "Ana", "2": "Miguel" },
    quickReplyButtons: OFFER_BUTTONS,
  },
  {
    purpose: "OPTIN_MARKETING", name: "fa_optin_marketing", category: "MARKETING", variableCount: 1,
    body: "Oi {{1}}! Além dos avisos da visita, quer também receber de vez em quando nossas ofertas e novidades (pacotes, promoções)? Responda SIM para aceitar ou PARAR para não receber mais mensagens.",
    sample: { "1": "Ana" },
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

// Só service_role chama esta function: ela cria/submete templates na Meta e
// ativa linhas de fa_crm_templates. verify_jwt = true sozinho NÃO basta — a
// chave anônima (pública, embutida na SPA) também é um JWT válido.
function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1].trim() : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function isServiceRole(req: Request): boolean {
  const token = bearer(req);
  if (!token) return false;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (key && timingSafeEqual(token, key)) return true;
  // JWT legado com role=service_role: a assinatura já foi validada pelo
  // gateway (verify_jwt = true), aqui só se lê o papel. Se o verify_jwt for
  // desligado, este ramo deixa de ser seguro — remova-o.
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return json({ error: "forbidden" }, 403);

  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: existing } = await admin.from("fa_crm_templates").select("id, name, purpose, content_sid, active");
  // Por nome, não por purpose: um purpose pode ter versões (ex.: VIP v1 e v2).
  const byName = new Map((existing ?? []).map((t) => [t.name, t]));

  const scope = parseScope(
    await req.text().catch(() => ""),
    new Set([...TEMPLATES.map((d) => d.name), ...byName.keys()]),
  );
  if (!scope.ok) return json({ error: scope.error }, 400);
  const only = scope.names;
  const dryRun = scope.dryRun;
  const inScope = (name: string) => !only || only.has(name);

  const results: Record<string, unknown>[] = [];

  // ── 1. Purposes já com content_sid real: confere aprovação; se nunca foi
  //      submetido (fetch não devolve status), submete agora. ──
  const defByName = new Map(TEMPLATES.map((d) => [d.name, d]));
  for (const row of existing ?? []) {
    if (row.active || !row.content_sid || RETIRED.has(row.name) || !inScope(row.name)) continue;
    if (dryRun) {
      results.push({ purpose: row.purpose, name: row.name, action: "[dryRun] conferiria a aprovação na Meta (ativa se aprovado; submete se nunca foi submetido)" });
      continue;
    }
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
      const def = defByName.get(row.name);
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

  // ── 2. Templates ainda não criados (por nome): cria + submete para aprovação. ──
  for (const def of TEMPLATES) {
    if (byName.has(def.name) || !inScope(def.name)) continue;
    if (dryRun) {
      results.push({ purpose: def.purpose, name: def.name, action: "[dryRun] criaria na Twilio e submeteria à Meta (ficaria inativo)" });
      continue;
    }

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
      category: def.category,
      active: false, // só ativa quando a Meta aprovar (rodar esta function de novo depois confere e ativa)
    });

    results.push({
      purpose: def.purpose,
      action: submitted ? "criado e submetido à Meta" : "criado, mas falha ao submeter aprovação",
      contentSid,
      approvalStatus: approval?.status ?? approval,
    });
  }

  return json({ ok: true, scope: only ? [...only] : "todos", dryRun, results });
});
