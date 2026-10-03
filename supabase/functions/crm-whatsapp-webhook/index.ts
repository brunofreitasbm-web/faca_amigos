import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  OFFER_DECLINE_REPLY, OFFER_INFO_FALLBACK, OFFER_KINDS, type OfferButton, offerButton, offerInfoKey,
  pickProductOffer, renewRequest, type SiteOfferKind, siteOfferKeyword, welcomeWithOffer,
} from "./offer.ts";
import { handleNps } from "../_shared/npsFlow.ts";
import { isNpsFinalReply } from "../_shared/nps.ts";

// Webhook do WhatsApp (Twilio, subconta do CRM). Recebe DOIS tipos de
// chamada na mesma URL:
//   - mensagem recebida do cliente (SmsStatus = "received")
//   - status de mensagem enviada por nós (MessageStatus = sent/delivered/read/failed…)
//
// verify_jwt = false (ver supabase/config.toml): a Twilio não manda JWT. A
// autorização é a ASSINATURA X-Twilio-Signature, conferida abaixo com o
// Auth Token da subconta — sem ela qualquer um poderia injetar conversas.
// Inline (sem _shared) pelo mesmo motivo de google-review-webhook.

const TWILIO_TOKEN_ENV = "TWILIO_CRM_AUTH_TOKEN";
const PUBLIC_URL_ENV = "CRM_WEBHOOK_PUBLIC_URL";
const DEFAULT_PUBLIC_URL = "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

// Palavras que o cliente manda para parar de receber nossas mensagens
// (exigência de boa prática do WhatsApp e LGPD art. 18, IX).
const OPT_OUT_WORDS = new Set(["parar", "pare", "sair", "stop", "cancelar", "descadastrar"]);
const OPT_IN_WORDS = new Set(["voltar", "start", "iniciar"]);
// Aceite do pedido de autorização (campanha de opt-in). "quero" vale mesmo sem
// pedido pendente (QR code do balcão); "sim" só responde a um pedido nosso.
const ACCEPT_WORDS = new Set(["sim", "quero", "aceito", "aceitar"]);

// Vantagem da 1ª mensagem de marketing, enviada na resposta ao SIM do opt-in
// de marketing (texto livre: a resposta do cliente abre a janela de 24h, sem
// template). Ex.: "15 min extras". Definida pelo dono via secret; sem ela, a
// confirmação sai sem oferta. Só quem aceitou MARKETING recebe oferta: o aceite
// geral cobre avisos da visita e pesquisa, não promoções.
const WELCOME_BENEFIT_ENV = "CRM_MARKETING_WELCOME_BENEFIT";
const WELCOME_VALID_DAYS = 30;

const twiml = (body = "") =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Assinatura Twilio: base64(HMAC-SHA1(token, url + chaves ordenadas concatenadas com valores)). */
async function validSignature(url: string, params: Record<string, string>, signature: string, token: string): Promise<boolean> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return timingSafeEqual(btoa(bin), signature);
}

const stripWhatsapp = (v: string) => v.replace(/^whatsapp:/i, "").trim();

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  accepted: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "undelivered",
};
// Só avança: um "sent" atrasado não pode rebaixar um "read" já gravado.
const STATUS_RANK: Record<string, number> = { received: 0, queued: 1, sent: 2, delivered: 3, read: 4, failed: 5, undelivered: 5 };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const token = Deno.env.get(TWILIO_TOKEN_ENV);
  if (!token) {
    console.error(`${TWILIO_TOKEN_ENV} não configurado — recusando por padrão seguro`);
    return new Response("webhook não configurado", { status: 503 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const signature = req.headers.get("X-Twilio-Signature") ?? "";
  const publicUrl = Deno.env.get(PUBLIC_URL_ENV) ?? DEFAULT_PUBLIC_URL;
  if (!(await validSignature(publicUrl, params, signature, token))) {
    return new Response("assinatura inválida", { status: 403 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const sid = params.MessageSid || params.SmsSid;
  if (!sid) return new Response("sem MessageSid", { status: 400 });

  // ── Status de mensagem enviada ──
  if (params.MessageStatus && params.SmsStatus !== "received") {
    const next = STATUS_MAP[params.MessageStatus.toLowerCase()];
    if (!next) return twiml();
    const { data: msg } = await admin.from("fa_crm_messages").select("id, status, contact_id").eq("twilio_sid", sid).maybeSingle();
    if (msg && (STATUS_RANK[next] ?? 0) > (STATUS_RANK[msg.status] ?? 0)) {
      await admin
        .from("fa_crm_messages")
        .update({ status: next, error: params.ErrorCode ? `Twilio ${params.ErrorCode}` : null })
        .eq("id", msg.id);
    }
    // 63024 = número sem WhatsApp (ou sem aceitar os termos): tira o responsável
    // das filas de opt-in para não gastar envio nem sujar o freio.
    if (msg && params.ErrorCode === "63024") {
      const { data: contact } = await admin.from("fa_crm_contacts").select("guardian_id").eq("id", msg.contact_id).maybeSingle();
      if (contact?.guardian_id) {
        await admin
          .from("fa_kiosk_guardians")
          .update({ whatsapp_invalid_at_ms: Date.now() })
          .eq("id", contact.guardian_id)
          .is("whatsapp_invalid_at_ms", null);
      }
    }
    return twiml();
  }

  // ── Mensagem recebida ──
  const from = stripWhatsapp(params.From ?? "");
  const to = stripWhatsapp(params.To ?? "");
  if (!from || !to) return new Response("From/To ausentes", { status: 400 });

  const { data: channel } = await admin
    .from("fa_crm_channels")
    .select("id, label")
    .eq("whatsapp_e164", to)
    .eq("active", true)
    .maybeSingle();
  if (!channel) {
    // Número não cadastrado como canal: aceita (200) para a Twilio não
    // reentregar, mas não grava — evita criar contato num canal inexistente.
    console.warn("mensagem para número sem canal cadastrado:", to);
    return twiml();
  }

  const body = (params.Body ?? "").trim();
  const numMedia = Number(params.NumMedia ?? "0") || 0;
  const media = Array.from({ length: numMedia }, (_, i) => ({
    url: params[`MediaUrl${i}`],
    contentType: params[`MediaContentType${i}`],
  })).filter((m) => m.url);
  const now = Date.now();
  const preview = (body || (media.length ? "📎 mídia" : "")).slice(0, 140);

  // Idempotência: a Twilio reentrega em timeout. Se o SID já existe, sai.
  const { data: dup } = await admin.from("fa_crm_messages").select("id").eq("twilio_sid", sid).maybeSingle();
  if (dup) return twiml();

  let { data: contact } = await admin
    .from("fa_crm_contacts")
    .select("id, name, unread_count, stage, opt_in, guardian_id")
    .eq("channel_id", channel.id)
    .eq("phone_e164", from)
    .maybeSingle();

  if (!contact) {
    const { data: created, error } = await admin
      .from("fa_crm_contacts")
      .insert({ channel_id: channel.id, phone_e164: from, name: params.ProfileName || null })
      .select("id, name, unread_count, stage, opt_in, guardian_id")
      .single();
    if (error) {
      console.error("erro ao criar contato:", error);
      return new Response("erro", { status: 500 }); // Twilio tenta de novo
    }
    contact = created;
  }

  const word = body.toLowerCase().replace(/[^a-zà-ú]/g, "");
  const optOut = OPT_OUT_WORDS.has(word);
  const optIn = OPT_IN_WORDS.has(word);

  if (optOut) {
    // PARAR encerra qualquer pedido de autorização pendente (geral ou de
    // marketing) e revoga os dois consentimentos do responsável.
    await admin
      .from("fa_crm_optin_requests")
      .update({ status: "DECLINED", answered_at_ms: now })
      .eq("contact_id", contact!.id)
      .eq("status", "SENT");
    await admin
      .from("fa_crm_marketing_optin_requests")
      .update({ status: "DECLINED", answered_at_ms: now })
      .eq("contact_id", contact!.id)
      .eq("status", "SENT");
    const guardianId = contact!.guardian_id ?? (await guardianByPhone(admin, from));
    if (guardianId) {
      await admin
        .from("fa_kiosk_guardians")
        .update({
          whatsapp_consent_at_ms: null, whatsapp_consent_by_employee_id: null,
          marketing_consent_at_ms: null, marketing_consent_by_employee_id: null,
        })
        .eq("id", guardianId);
    }
  }

  const { error: msgError } = await admin.from("fa_crm_messages").insert({
    contact_id: contact!.id,
    direction: "IN",
    body,
    media,
    twilio_sid: sid,
    status: "received",
    created_at_ms: now,
  });
  if (msgError) {
    console.error("erro ao gravar mensagem:", msgError);
    return new Response("erro", { status: 500 });
  }

  await admin
    .from("fa_crm_contacts")
    .update({
      last_inbound_ms: now,
      last_message_ms: now,
      last_message_preview: preview,
      unread_count: (contact!.unread_count ?? 0) + 1,
      stage: contact!.stage === "NOVO" ? "EM_CONVERSA" : contact!.stage === "INATIVO" ? "EM_CONVERSA" : contact!.stage,
      ...(optOut ? { opt_in: false } : optIn ? { opt_in: true } : {}),
    })
    .eq("id", contact!.id);

  // ── Resposta automática (opt-out/opt-in, ofertas, renovação e NPS) ──
  // Botão de oferta vem antes do aceite: "Quero saber mais" não pode virar
  // opt-in. Sem oferta recente para o contato, segue o fluxo normal.
  const offer = optOut || optIn ? null : offerButton(params.ButtonPayload, body);
  const offerReply = offer ? await handleOffer(admin, contact!.id, offer, now) : null;
  // Botão SIM do aviso de excedente (fa_visita_excedente_v2): renova o plano atual.
  const overageReply =
    optOut || optIn || offerReply || params.ButtonPayload !== OVERAGE_RENEW_PAYLOAD
      ? null
      : await handleOverageRenewal(admin, contact!.id, now);
  // Texto pré-preenchido do card de oferta da tela de acompanhamento ("Quero saber do Porto Seguro").
  const siteKind = optOut || optIn || offerReply || overageReply ? null : siteOfferKeyword(body);
  const siteReply = siteKind ? await handleSiteOffer(admin, contact!, siteKind, now) : null;
  // Botão "Renovar" da tela de acompanhamento ("Quero renovar +30 min da Maria").
  const renew = optOut || optIn || offerReply || overageReply || siteReply ? null : renewRequest(body);
  const renewReply = renew ? await handleRenewRequest(admin, contact!.id, renew.minutes, renew.childHint, now) : null;

  // Pergunta da pesquisa de NPS no meio da conversa: não leva a mensagem de fechamento (só o agradecimento final leva).
  let npsQuestion = false;
  const npsReply = async () => {
    const r = await handleNps(admin, contact!.id, body, now);
    if (r && !isNpsFinalReply(r)) npsQuestion = true;
    return r;
  };

  let reply: string | null = null;
  if (optOut) reply = "Tudo certo, você não receberá mais mensagens nossas. Para voltar, responda VOLTAR.";
  else if (optIn) reply = "Que bom ter você de volta! 💛";
  else if (offerReply) reply = offerReply;
  else if (overageReply) reply = overageReply;
  else if (siteReply) reply = siteReply;
  else if (renewReply) reply = renewReply;
  else if (ACCEPT_WORDS.has(word)) {
    // Um "SIM"/"QUERO" pode responder aos dois pedidos ao mesmo tempo, se
    // ambos estiverem em aberto para este contato (geral + marketing).
    const acceptedGeneral = await handleOptinAccept(admin, contact!, from, word, now);
    const acceptedMarketing = await handleMarketingOptinAccept(admin, contact!, from, now);
    if (acceptedGeneral || acceptedMarketing) {
      reply = acceptedMarketing
        ? await marketingReply(admin, contact!.id, acceptedMarketing, marketingWelcome(contact!.name, now), now)
        : "Combinado! 💛 Vamos te avisar por aqui sobre suas visitas e, às vezes, pedir sua opinião. Para parar, é só responder PARAR.";
    } else {
      const choice = renewalChoice(params.ButtonPayload, body);
      reply = choice ? await handleRenewal(admin, contact!.id, choice, now) : null;
      reply ??= await npsReply();
    }
  } else {
    const choice = renewalChoice(params.ButtonPayload, body);
    reply = choice ? await handleRenewal(admin, contact!.id, choice, now) : null;
    reply ??= await npsReply();
  }

  if (!reply) return twiml();
  if (!optOut && !npsQuestion) reply = await withClosing(admin, contact!.id, reply, now);

  // Grava a resposta automática no histórico para a equipe ver a conversa inteira.
  await admin.from("fa_crm_messages").insert({
    contact_id: contact!.id,
    direction: "OUT",
    body: reply,
    status: "sent",
    created_at_ms: now + 1,
  });
  await admin
    .from("fa_crm_contacts")
    .update({ last_message_ms: now + 1, last_message_preview: `Você: ${reply}`.slice(0, 140) })
    .eq("id", contact!.id);
  return twiml(`<Message>${reply.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>`);
});

/** Confirmação do aceite de marketing, com a vantagem de boas-vindas se configurada. */
function marketingWelcome(name: string | null, now: number): string {
  const benefit = Deno.env.get(WELCOME_BENEFIT_ENV)?.trim();
  if (!benefit) {
    return "Combinado! 💛 Você também vai receber, de vez em quando, nossas ofertas e novidades. Para parar, é só responder PARAR.";
  }
  const firstName = (name ?? "").trim().split(/\s+/)[0];
  const until = new Date(now + WELCOME_VALID_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString("pt-BR", {
    timeZone: "America/Belem",
    day: "2-digit",
    month: "2-digit",
  });
  return (
    `Combinado${firstName ? `, ${firstName}` : ""}! 💛 Para comemorar, sua próxima visita ao FaçaAmigos ganha ${benefit}. ` +
    `É só mostrar esta mensagem na recepção até ${until}. Para não receber mais ofertas, responda PARAR.`
  );
}

/**
 * Opção escolhida (1-3) na oferta de renovação: botão de resposta rápida do
 * template (payload RENOVAR_1..3) ou o cliente digitando só "1", "2" ou "3".
 * Digitar só vale se houver aviso em aberto — handleRenewal devolve null e a
 * mensagem segue como conversa/NPS quando não houver.
 */
function renewalChoice(buttonPayload: string | undefined, body: string): number | null {
  const fromButton = buttonPayload?.match(/^RENOVAR_([1-3])$/);
  if (fromButton) return Number(fromButton[1]);
  const typed = body.match(/^\s*([1-3])\s*[).]?\s*$/);
  return typed ? Number(typed[1]) : null;
}

type RenewalResult =
  | { status: "OK"; minutes: number; cents: number }
  | { status: "ALREADY" | "EXPIRED" | "NONE" };

/** Pedido gravado como RENOVACAO_SOLICITADA (o balcão já consome); devolve a resposta automática ou null. */
async function handleRenewal(admin: ReturnType<typeof createClient>, contactId: string, choice: number, now: number): Promise<string | null> {
  const { data, error } = await admin.rpc("fa_crm_renewal_choose", { p_contact_id: contactId, p_choice: choice, p_now_ms: now });
  if (error) {
    console.error("renovação:", error);
    return null;
  }
  const result = data as RenewalResult;
  return result.status === "NONE" ? null : renewalReplyText(result);
}

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

function renewalReplyText(result: RenewalResult): string {
  // TODO(human): tom de voz de cada desfecho do pedido de renovação.
  switch (result.status) {
    case "OK":
      return `Combinado! Avisamos a recepção: +${result.minutes} min por ${brl(result.cents)}. O valor é acertado no balcão. 💛`;
    case "ALREADY":
      return "Já avisamos a recepção sobre o seu pedido. 💛";
    default:
      return "Essa visita já foi encerrada. Até a próxima! 💛";
  }
}

/** Payload do botão SIM do template fa_visita_excedente_v2 (ver crm-templates-bootstrap). */
const OVERAGE_RENEW_PAYLOAD = "RENOVAR_ATUAL";

type OverageRenewalResult =
  | { status: "OK"; minutes: number; cents: number }
  | { status: "ALREADY" | "EXPIRED" | "NONE" };

const planLabel = (minutes: number) =>
  minutes % 60 === 0 ? (minutes === 60 ? "1 hora" : `${minutes / 60} horas`) : `${minutes} min`;

/** Toque em SIM no aviso de excedente: pedido de renovação do plano atual no balcão; devolve a resposta ou null. */
async function handleOverageRenewal(admin: ReturnType<typeof createClient>, contactId: string, now: number): Promise<string | null> {
  const { data, error } = await admin.rpc("fa_crm_overage_renew", { p_contact_id: contactId, p_now_ms: now });
  if (error) {
    console.error("renovação do excedente:", error);
    return null;
  }
  const result = data as OverageRenewalResult;
  switch (result.status) {
    case "OK":
      return `Combinado! Avisamos a recepção para renovar o plano: ${planLabel(result.minutes)} por ${brl(result.cents)}. Você recebe a confirmação assim que a equipe aplicar. 💛`;
    case "ALREADY":
      return "Já avisamos a recepção sobre o seu pedido. 💛";
    case "EXPIRED":
      return "Essa visita já foi encerrada. Até a próxima! 💛";
    default:
      return null;
  }
}

const CLOSING_URLS = ["https://institutofacaamigos.com.br/", "https://www.instagram.com/facaamigos.belem/"] as const;
const CLOSING_TEXT =
  "Pra continuar pertinho do FaçaAmigos, vem conhecer nosso mundo em https://institutofacaamigos.com.br/ " +
  "e acompanhar a brincadeira de cada dia no Instagram: https://www.instagram.com/facaamigos.belem/ 💛";
const CLOSING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Mensagem de fechamento: convite ao site e ao Instagram no fim de toda
 * resposta automática (texto livre dentro da janela de 24h aberta pelo cliente,
 * sem template e sem Meta). No máximo uma vez a cada 24h por contato, e nunca
 * duplica quando a própria resposta já traz os links.
 */
async function withClosing(admin: ReturnType<typeof createClient>, contactId: string, reply: string, now: number): Promise<string> {
  if (CLOSING_URLS.some((u) => reply.includes(u))) return reply;
  const { data: recent } = await admin
    .from("fa_crm_messages")
    .select("id")
    .eq("contact_id", contactId)
    .eq("direction", "OUT")
    .gte("created_at_ms", now - CLOSING_INTERVAL_MS)
    .ilike("body", "%instagram.com/facaamigos.belem%")
    .limit(1);
  if (recent?.length) return reply;
  return `${reply}\n\n${CLOSING_TEXT}`;
}

const OFFER_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Toque em "Quero saber mais" / "Agora não" numa oferta da régua. Grava a
 * resposta no envio mais recente (últimos 7 dias) — é o que alimenta
 * fa_crm_automation_stats e a pausa de 90 dias do "Agora não" em
 * fa_crm_lc_candidates. Sem oferta recente devolve null.
 */
async function handleOffer(admin: ReturnType<typeof createClient>, contactId: string, button: OfferButton, now: number): Promise<string | null> {
  const { data: send } = await admin
    .from("fa_crm_automation_sends")
    .select("id, kind")
    .eq("contact_id", contactId)
    .eq("status", "SENT")
    .in("kind", [...OFFER_KINDS])
    .gt("sent_at_ms", now - OFFER_REPLY_WINDOW_MS)
    .order("sent_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!send) return null;

  await admin
    .from("fa_crm_automation_sends")
    .update({ replied_at_ms: now, reply_payload: { button } })
    .eq("id", send.id);

  if (button === "OFERTA_NAO") return OFFER_DECLINE_REPLY;
  const { data: info } = await admin
    .from("fa_crm_offer_info")
    .select("reply_text")
    .eq("kind", offerInfoKey(send.kind as string))
    .maybeSingle();
  return (info?.reply_text as string | undefined) ?? OFFER_INFO_FALLBACK;
}

async function guardianByPhone(admin: ReturnType<typeof createClient>, phone: string): Promise<string | null> {
  const { data } = await admin.from("fa_kiosk_guardians").select("id").eq("phone_e164", phone).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Registra o aceite de contato quando o cliente responde SIM/QUERO. Devolve
 * true se gravou (aí a resposta automática confirma); false se "sim" não
 * respondia a nenhum pedido nosso — segue como conversa normal.
 */
async function handleOptinAccept(
  admin: ReturnType<typeof createClient>,
  contact: { id: string; guardian_id: string | null },
  phone: string,
  word: string,
  now: number,
): Promise<boolean> {
  const { data: pending } = await admin
    .from("fa_crm_optin_requests")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("status", "SENT")
    .limit(1)
    .maybeSingle();
  if (!pending && word !== "quero") return false;

  const guardianId = contact.guardian_id ?? (await guardianByPhone(admin, phone));
  if (!guardianId) return false; // sem cadastro no kiosk não há onde gravar o aceite

  await admin.from("fa_kiosk_guardians").update({ whatsapp_consent_at_ms: now }).eq("id", guardianId);
  if (pending) {
    await admin.from("fa_crm_optin_requests").update({ status: "ACCEPTED", answered_at_ms: now }).eq("id", pending.id);
  }
  if (!contact.guardian_id) await admin.from("fa_crm_contacts").update({ guardian_id: guardianId }).eq("id", contact.id);
  return true;
}

/**
 * Registra o aceite de MARKETING quando o cliente responde SIM/QUERO a um
 * pedido de fa_crm_marketing_optin_requests em aberto. Ao contrário do aceite
 * geral, "quero" sozinho (sem pedido pendente) NÃO basta aqui — não existe
 * QR code de balcão para marketing, só a campanha. Devolve o id do
 * responsável se gravou, senão null.
 */
async function handleMarketingOptinAccept(
  admin: ReturnType<typeof createClient>,
  contact: { id: string; guardian_id: string | null },
  phone: string,
  now: number,
): Promise<string | null> {
  const { data: pending } = await admin
    .from("fa_crm_marketing_optin_requests")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("status", "SENT")
    .limit(1)
    .maybeSingle();
  if (!pending) return null;

  const guardianId = contact.guardian_id ?? (await guardianByPhone(admin, phone));
  if (!guardianId) return null;

  await admin.from("fa_kiosk_guardians").update({ marketing_consent_at_ms: now }).eq("id", guardianId);
  await admin.from("fa_crm_marketing_optin_requests").update({ status: "ACCEPTED", answered_at_ms: now }).eq("id", pending.id);
  if (!contact.guardian_id) await admin.from("fa_crm_contacts").update({ guardian_id: guardianId }).eq("id", contact.id);
  return guardianId;
}

/** Flag crm_lc_<kind> ligada (na unidade da oferta, ou em qualquer uma quando a oferta não é de uma unidade). */
async function offerFlagOn(admin: ReturnType<typeof createClient>, kind: string, unitId: string | null): Promise<boolean> {
  let q = admin.from("fa_kiosk_app_settings").select("value").eq("key", `crm_lc_${kind.toLowerCase()}`).eq("value", "1").limit(1);
  if (unitId) q = q.eq("unit_id", unitId);
  const { data } = await q;
  return !!data?.length;
}

async function offerInfoText(admin: ReturnType<typeof createClient>, kind: string): Promise<string> {
  const { data } = await admin.from("fa_crm_offer_info").select("reply_text").eq("kind", offerInfoKey(kind)).maybeSingle();
  return (data?.reply_text as string | undefined) ?? OFFER_INFO_FALLBACK;
}

/** Registra a oferta enviada em texto livre, para as estatísticas, a trava de frequência e o "Agora não". */
async function recordFreeformOffer(
  admin: ReturnType<typeof createClient>,
  contact: { id: string; guardian_id: string | null },
  kind: string,
  unitId: string | null,
  via: "optin_reply" | "site_card",
  now: number,
): Promise<void> {
  const { error } = await admin.from("fa_crm_automation_sends").insert({
    kind,
    unit_id: unitId,
    contact_id: contact.id,
    guardian_id: contact.guardian_id,
    ref_key: `${via}:${contact.id}:${now}`,
    payload: { via },
    status: "SENT",
    sent_at_ms: now,
  });
  if (error) console.error("registro da oferta em texto livre:", error.message);
}

/**
 * Resposta ao SIM do aceite de marketing: a confirmação de sempre mais a
 * primeira oferta de produto que o responsável já mereceria na régua (mesma
 * ordem de prioridade, mesma flag por unidade, mesma trava de 1 marketing a
 * cada 7 dias). Texto livre, dentro da janela aberta pelo SIM: sem template.
 * Sem oferta elegível, sai só a confirmação.
 */
async function marketingReply(
  admin: ReturnType<typeof createClient>,
  contactId: string,
  guardianId: string,
  welcome: string,
  now: number,
): Promise<string> {
  try {
    const { data: canSend } = await admin.rpc("fa_crm_can_send", { p_contact_id: contactId, p_category: "MARKETING", p_now_ms: now });
    if (canSend === false) return welcome;
    const { data: candidates } = await admin.rpc("fa_crm_lc_candidates", { p_now_ms: now });
    const mine = ((candidates ?? []) as { kind: string; guardian_id: string | null; unit_id: string | null }[])
      .filter((c) => c.guardian_id === guardianId);
    // A RPC já vem em ordem de prioridade; descarta os kinds com a flag desligada antes de escolher.
    const enabled: typeof mine = [];
    for (const c of mine) if (await offerFlagOn(admin, c.kind, c.unit_id)) enabled.push(c);
    const pick = pickProductOffer(enabled, guardianId);
    if (!pick) return welcome;
    await recordFreeformOffer(admin, { id: contactId, guardian_id: guardianId }, pick.kind, pick.unit_id, "optin_reply", now);
    return welcomeWithOffer(welcome, await offerInfoText(admin, pick.kind));
  } catch (e) {
    console.error("oferta na resposta ao aceite:", e);
    return welcome; // a confirmação nunca deixa de sair por causa da oferta
  }
}

/**
 * Pedido do card de oferta da tela de acompanhamento. Quem escreve pediu a
 * informação, então responde mesmo sem aceite de marketing; não grava aceite.
 * Fica registrado em fa_crm_automation_sends, o que também segura a régua por 7 dias.
 */
async function handleSiteOffer(
  admin: ReturnType<typeof createClient>,
  contact: { id: string; guardian_id: string | null },
  kind: SiteOfferKind,
  now: number,
): Promise<string | null> {
  const text = await offerInfoText(admin, kind);
  await recordFreeformOffer(admin, contact, kind, null, "site_card", now);
  return text;
}

const RENEW_HELP =
  "Para renovar, toque em um dos botões na tela de acompanhamento ou responda “Quero renovar 30” (+30 min por R$ 48,00) ou “Quero renovar 60” (+60 min por R$ 96,00). 💛";

type RenewRequestResult =
  | { status: "OK"; minutes: number; cents: number }
  | { status: "ALREADY" | "AMBIGUOUS" | "NO_SESSION" | "INVALID" };

/**
 * Pedido de renovação iniciado pelo responsável (texto livre dentro da janela
 * que a própria mensagem abriu). Grava o mesmo RENOVACAO_SOLICITADA que o
 * balcão já lista; o valor é acertado no caixa.
 */
async function handleRenewRequest(
  admin: ReturnType<typeof createClient>,
  contactId: string,
  minutes: 30 | 60 | null,
  childHint: string | null,
  now: number,
): Promise<string> {
  if (!minutes) return RENEW_HELP;
  const { data, error } = await admin.rpc("fa_crm_renew_request", {
    p_contact_id: contactId, p_minutes: minutes, p_child_hint: childHint, p_now_ms: now,
  });
  if (error) {
    console.error("pedido de renovação:", error);
    return "Não consegui registrar agora. Fale com a nossa equipe no balcão que renovamos na hora. 💛";
  }
  const r = data as RenewRequestResult;
  switch (r.status) {
    case "OK":
      return `Combinado! Avisamos a recepção: +${r.minutes} min por ${brl(r.cents)}. O valor é acertado no balcão. 💛`;
    case "ALREADY":
      return "Já avisamos a recepção sobre o seu pedido. 💛";
    case "AMBIGUOUS":
      return "Você tem mais de uma criança brincando. Toque no botão de renovar da criança certa na tela de acompanhamento. 💛";
    case "NO_SESSION":
      return "Não encontramos uma visita ativa no Playground para este número. Fale com a nossa equipe no balcão. 💛";
    default:
      return RENEW_HELP;
  }
}
