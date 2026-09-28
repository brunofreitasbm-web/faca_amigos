import { createClient } from "jsr:@supabase/supabase-js@2";

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
    const { data: msg } = await admin.from("fa_crm_messages").select("id, status").eq("twilio_sid", sid).maybeSingle();
    if (msg && (STATUS_RANK[next] ?? 0) > (STATUS_RANK[msg.status] ?? 0)) {
      await admin
        .from("fa_crm_messages")
        .update({ status: next, error: params.ErrorCode ? `Twilio ${params.ErrorCode}` : null })
        .eq("id", msg.id);
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
    .select("id, unread_count, stage, opt_in")
    .eq("channel_id", channel.id)
    .eq("phone_e164", from)
    .maybeSingle();

  if (!contact) {
    const { data: created, error } = await admin
      .from("fa_crm_contacts")
      .insert({ channel_id: channel.id, phone_e164: from, name: params.ProfileName || null })
      .select("id, unread_count, stage, opt_in")
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

  // ── Resposta automática (opt-out/opt-in e NPS) ──
  let reply: string | null = null;
  if (optOut) reply = "Tudo certo, você não receberá mais mensagens nossas. Para voltar, responda VOLTAR.";
  else if (optIn) reply = "Que bom ter você de volta! 💛";
  else reply = await handleNps(admin, contact!.id, body, now);

  if (!reply) return twiml();

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

const NPS_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // nota: até 7 dias após o envio
const NPS_FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000; // comentário: até 24h após a nota

/**
 * Fluxo do NPS por WhatsApp. Devolve o texto da resposta automática, ou
 * null quando a mensagem não faz parte de uma pesquisa em aberto (segue
 * como conversa normal para a equipe).
 *   SENT   + "0".."10"  -> grava a nota, pergunta o motivo      (SCORED)
 *   SCORED + texto      -> grava o comentário, agradece         (DONE)
 */
async function handleNps(admin: ReturnType<typeof createClient>, contactId: string, body: string, now: number): Promise<string | null> {
  const { data: survey } = await admin
    .from("fa_crm_nps_surveys")
    .select("id, status, sent_at_ms, scored_at_ms, score")
    .eq("contact_id", contactId)
    .in("status", ["SENT", "SCORED"])
    .order("sent_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!survey) return null;

  if (survey.status === "SENT") {
    if (now - Number(survey.sent_at_ms) > NPS_REPLY_WINDOW_MS) {
      await admin.from("fa_crm_nps_surveys").update({ status: "EXPIRED" }).eq("id", survey.id);
      return null;
    }
    // Só conta como nota se a mensagem for basicamente o número ("9", "10", "nota 8").
    const m = body.length <= 40 ? body.match(/(?:^|\D)(10|\d)(?!\d)/) : null;
    if (!m) return null;
    const score = Number(m[1]);
    await admin.from("fa_crm_nps_surveys").update({ status: "SCORED", score, scored_at_ms: now }).eq("id", survey.id);
    return score >= 9
      ? "Que alegria! 💛 Obrigado pela nota. Quer contar o que mais gostou? É só responder aqui."
      : score >= 7
        ? "Obrigado pela nota! 💛 O que podemos fazer para sua próxima visita ser ainda melhor?"
        : "Poxa, sentimos muito. 😔 Pode nos contar o que aconteceu? Vamos usar seu retorno para melhorar.";
  }

  // SCORED: a próxima mensagem de texto é o comentário.
  if (now - Number(survey.scored_at_ms) > NPS_FEEDBACK_WINDOW_MS) {
    await admin.from("fa_crm_nps_surveys").update({ status: "DONE", done_at_ms: now }).eq("id", survey.id);
    return null;
  }
  if (!body) return null; // só mídia: espera o texto
  await admin.from("fa_crm_nps_surveys").update({ status: "DONE", feedback: body.slice(0, 1000), done_at_ms: now }).eq("id", survey.id);
  return "Muito obrigado pelo seu retorno! Ele ajuda a melhorar cada visita. 💛";
}
