// Envio de WhatsApp via Twilio (subconta do CRM) reutilizável por Edge Functions
// que precisam falar com o responsável sem passar pela tela do CRM.
//
// Mesmas regras de crm-whatsapp-send (que continua com sua cópia inline, sem
// refatorar de propósito — função em produção): texto livre só dentro da
// janela de 24h da última mensagem do cliente; fora dela, só template aprovado.
// Contato com opt_in = false nunca recebe nada.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
}

export interface CrmChannel {
  id: string;
  unit_id: string | null;
  label: string;
  whatsapp_e164: string;
  is_sandbox: boolean;
}

export interface CrmContact {
  id: string;
  phone_e164: string;
  name: string | null;
  opt_in: boolean;
  last_inbound_ms: number | null;
}

export interface CrmTemplate {
  id: string;
  name: string;
  content_sid: string;
  preview: string;
  variable_count: number;
}

export function twilioCreds(): TwilioCreds | null {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  return accountSid && authToken ? { accountSid, authToken } : null;
}

export function webhookUrl(): string {
  return (
    Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ??
    "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook"
  );
}

export function inFreeformWindow(lastInboundMs: number | null, now = Date.now()): boolean {
  return lastInboundMs != null && now - Number(lastInboundMs) < WHATSAPP_WINDOW_MS;
}

/**
 * Canal ativo da unidade. Com mais de um (Playground e Circuito), prefere o que
 * casa com a atividade da sessão, como o NPS automático faz; sem casamento, se
 * houver um único candidato usa-o; se ainda ambíguo, devolve null (não chuta).
 */
export async function findActiveChannelForUnit(
  admin: SupabaseClient,
  unitId: string,
  activity: string | null,
): Promise<CrmChannel | null> {
  const { data } = await admin
    .from("fa_crm_channels")
    .select("id, unit_id, label, whatsapp_e164, is_sandbox")
    .eq("active", true);
  const all = (data ?? []) as CrmChannel[];
  const ofUnit = all.filter((c) => c.unit_id === unitId);
  const pool = ofUnit.length ? ofUnit : all.filter((c) => c.unit_id == null);
  if (pool.length === 1) return pool[0]!;
  if (pool.length > 1 && activity) {
    const wantsCircuito = activity === "CARRINHO";
    const match = pool.filter((c) => c.label.toLowerCase().includes("circuito") === wantsCircuito);
    if (match.length === 1) return match[0]!;
  }
  return null;
}

export async function upsertCrmContact(
  admin: SupabaseClient,
  args: { channelId: string; phoneE164: string; name: string | null; guardianId: string | null },
): Promise<CrmContact | null> {
  const cols = "id, phone_e164, name, opt_in, last_inbound_ms";
  const { data: found } = await admin
    .from("fa_crm_contacts")
    .select(cols)
    .eq("channel_id", args.channelId)
    .eq("phone_e164", args.phoneE164)
    .maybeSingle();
  if (found) return found as CrmContact;
  const { data: created, error } = await admin
    .from("fa_crm_contacts")
    .insert({ channel_id: args.channelId, phone_e164: args.phoneE164, name: args.name, guardian_id: args.guardianId })
    .select(cols)
    .single();
  if (error) {
    // Corrida com o webhook criando o mesmo contato: relê.
    const { data: again } = await admin
      .from("fa_crm_contacts")
      .select(cols)
      .eq("channel_id", args.channelId)
      .eq("phone_e164", args.phoneE164)
      .maybeSingle();
    return (again as CrmContact | null) ?? null;
  }
  return created as CrmContact;
}

export async function findActiveTemplate(admin: SupabaseClient, purpose: string): Promise<CrmTemplate | null> {
  const { data } = await admin
    .from("fa_crm_templates")
    .select("id, name, content_sid, preview, variable_count")
    .eq("purpose", purpose)
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CrmTemplate | null) ?? null;
}

export type OutgoingContent =
  | { kind: "TEXT"; body: string }
  | { kind: "TEMPLATE"; template: CrmTemplate; variables: Record<string, string> };

export type SendResult =
  | { ok: true; sid: string; messageId: string | null }
  | { ok: false; error: string; twilioCode?: number };

/** Faz o POST na Twilio e registra a mensagem OUT no CRM (mesmo formato de crm-whatsapp-send). */
export async function sendWhatsapp(
  admin: SupabaseClient,
  creds: TwilioCreds,
  args: { channel: CrmChannel; contact: CrmContact; sentByEmployeeId: string | null; content: OutgoingContent },
): Promise<SendResult> {
  const { channel, contact, content } = args;
  if (!contact.opt_in) return { ok: false, error: "contato pediu para não receber mensagens" };
  if (content.kind === "TEXT" && !inFreeformWindow(contact.last_inbound_ms)) {
    return { ok: false, error: "fora da janela de 24h — exige template aprovado" };
  }

  const form = new URLSearchParams({
    From: `whatsapp:${channel.whatsapp_e164}`,
    To: `whatsapp:${contact.phone_e164}`,
    StatusCallback: webhookUrl(),
  });
  let stored: string;
  let templateId: string | null = null;
  if (content.kind === "TEMPLATE") {
    form.set("ContentSid", content.template.content_sid);
    form.set("ContentVariables", JSON.stringify(content.variables));
    templateId = content.template.id;
    stored = content.template.preview.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => content.variables[n] ?? "");
  } else {
    form.set("Body", content.body);
    stored = content.body;
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${creds.accountSid}:${creds.authToken}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Twilio recusou envio:", out?.code, out?.message);
    return { ok: false, error: out?.message ?? "Twilio recusou o envio", twilioCode: out?.code };
  }

  const now = Date.now();
  const { data: msg } = await admin
    .from("fa_crm_messages")
    .insert({
      contact_id: contact.id,
      direction: "OUT",
      body: stored,
      twilio_sid: out.sid,
      status: "queued",
      template_id: templateId,
      sent_by_employee_id: args.sentByEmployeeId,
      created_at_ms: now,
    })
    .select("id")
    .maybeSingle();
  await admin
    .from("fa_crm_contacts")
    .update({ last_message_ms: now, last_message_preview: `Você: ${stored}`.slice(0, 140) })
    .eq("id", contact.id);

  return { ok: true, sid: out.sid as string, messageId: (msg?.id as string | undefined) ?? null };
}
