import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

// Envio de WhatsApp pelo CRM (Twilio, subconta dedicada).
//
// Regras do WhatsApp aplicadas AQUI, no servidor, não na SPA:
//   1. Só dentro da janela de 24h da última mensagem do cliente vale texto
//      livre; fora dela só template aprovado (templateId + variables).
//   2. Contato com opt_in = false (mandou PARAR) não recebe nada.
// A SPA replica a regra só para desabilitar o botão — quem decide é esta function.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

interface SendBody {
  contactId?: string;
  body?: string;
  templateId?: string;
  variables?: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "crm.write");
  if (!auth.ok) return auth.response;

  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return jsonResponse(req, { error: "Twilio do CRM não configurado" }, 503);

  let input: SendBody;
  try {
    input = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!input.contactId) return jsonResponse(req, { error: "contactId obrigatório" }, 400);
  const text = (input.body ?? "").trim();
  if (!text && !input.templateId) return jsonResponse(req, { error: "mensagem vazia" }, 400);
  if (text.length > 1600) return jsonResponse(req, { error: "mensagem longa demais (máx. 1600)" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: contact } = await admin
    .from("fa_crm_contacts")
    .select("id, phone_e164, opt_in, last_inbound_ms, channel:fa_crm_channels(whatsapp_e164, active)")
    .eq("id", input.contactId)
    .maybeSingle();
  if (!contact) return jsonResponse(req, { error: "contato não encontrado" }, 404);
  const channel = contact.channel as unknown as { whatsapp_e164: string; active: boolean } | null;
  if (!channel?.active) return jsonResponse(req, { error: "canal inativo" }, 409);
  if (!contact.opt_in) return jsonResponse(req, { error: "cliente pediu para não receber mensagens" }, 409);

  const inWindow = contact.last_inbound_ms != null && Date.now() - Number(contact.last_inbound_ms) < WINDOW_MS;

  const form = new URLSearchParams({
    From: `whatsapp:${channel.whatsapp_e164}`,
    To: `whatsapp:${contact.phone_e164}`,
    StatusCallback: WEBHOOK_URL,
  });

  let templateId: string | null = null;
  let stored = text;
  if (input.templateId) {
    const { data: tpl } = await admin
      .from("fa_crm_templates")
      .select("id, content_sid, preview, active")
      .eq("id", input.templateId)
      .maybeSingle();
    if (!tpl || !tpl.active) return jsonResponse(req, { error: "template não encontrado" }, 404);
    templateId = tpl.id;
    form.set("ContentSid", tpl.content_sid);
    if (input.variables && Object.keys(input.variables).length) form.set("ContentVariables", JSON.stringify(input.variables));
    stored = tpl.preview.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => input.variables?.[n] ?? "");
  } else {
    if (!inWindow) {
      return jsonResponse(req, { error: "fora da janela de 24h — envie um template aprovado", code: "WINDOW_CLOSED" }, 409);
    }
    form.set("Body", text);
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Twilio recusou envio:", out);
    return jsonResponse(req, { error: out.message ?? "Twilio recusou o envio", twilioCode: out.code }, 502);
  }

  const now = Date.now();
  const { data: employee } = await admin.from("fa_kiosk_employees").select("id").eq("auth_user_id", auth.userId).maybeSingle();

  await admin.from("fa_crm_messages").insert({
    contact_id: contact.id,
    direction: "OUT",
    body: stored,
    twilio_sid: out.sid,
    status: "queued",
    template_id: templateId,
    sent_by_employee_id: employee?.id ?? null,
    created_at_ms: now,
  });
  await admin
    .from("fa_crm_contacts")
    .update({ last_message_ms: now, last_message_preview: `Você: ${stored}`.slice(0, 140) })
    .eq("id", contact.id);

  return jsonResponse(req, { ok: true, sid: out.sid });
});
