import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";
import { loadUnitOptions, npsVariables, renderNpsPreview, templateAsksUnit } from "../_shared/npsSurvey.ts";

// Dispara a pesquisa de NPS por WhatsApp para uma lista de contatos do CRM.
// A resposta (nota 0-10 e comentário) é tratada por crm-whatsapp-webhook.
//
// Mensagem iniciada por nós = fora da janela de 24h = precisa de template
// aprovado com purpose 'NPS' (fa_crm_templates). Variável {{1}} = primeiro nome.
//
// Proteções contra spam, aplicadas aqui e não na SPA:
//   - contato com opt_in = false é pulado;
//   - contato com pesquisa enviada nos últimos 30 dias (ou ainda em aberto) é pulado;
//   - no máximo MAX_PER_CALL contatos por chamada.

const MAX_PER_CALL = 100;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "crm.write");
  if (!auth.ok) return auth.response;

  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return jsonResponse(req, { error: "Twilio do CRM não configurado" }, 503);

  let input: { contactIds?: string[] };
  try {
    input = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  const ids = [...new Set(input.contactIds ?? [])].slice(0, MAX_PER_CALL);
  if (ids.length === 0) return jsonResponse(req, { error: "contactIds obrigatório" }, 400);
  if ((input.contactIds?.length ?? 0) > MAX_PER_CALL) {
    return jsonResponse(req, { error: `máximo de ${MAX_PER_CALL} contatos por envio` }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: template } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview")
    .eq("purpose", "NPS")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) {
    return jsonResponse(req, { error: "Nenhum template de NPS aprovado cadastrado (fa_crm_templates, purpose = NPS)" }, 409);
  }

  // Só o template novo pergunta a unidade; o antigo segue direto para a nota.
  const unitOptions = templateAsksUnit(template.preview) ? await loadUnitOptions(admin) : null;
  if (unitOptions && unitOptions.length === 0) {
    return jsonResponse(req, { error: "Nenhuma unidade cadastrada para montar a pergunta do NPS" }, 409);
  }

  const { data: employee } = await admin.from("fa_kiosk_employees").select("id").eq("auth_user_id", auth.userId).maybeSingle();

  const { data: contacts } = await admin
    .from("fa_crm_contacts")
    .select("id, name, phone_e164, opt_in, channel_id, channel:fa_crm_channels(whatsapp_e164, active)")
    .in("id", ids);

  const now = Date.now();
  const { data: recent } = await admin
    .from("fa_crm_nps_surveys")
    .select("contact_id, status, sent_at_ms")
    .in("contact_id", ids)
    .gte("sent_at_ms", now - COOLDOWN_MS);
  const blocked = new Set((recent ?? []).map((r) => r.contact_id as string));

  const result = { sent: 0, skippedOptOut: 0, skippedRecent: 0, failed: 0 };

  for (const c of contacts ?? []) {
    const channel = c.channel as unknown as { whatsapp_e164: string; active: boolean } | null;
    if (!c.opt_in) {
      result.skippedOptOut++;
      continue;
    }
    if (blocked.has(c.id)) {
      result.skippedRecent++;
      continue;
    }
    if (!channel?.active) {
      result.failed++;
      continue;
    }

    const firstName = (c.name ?? "").trim().split(/\s+/)[0] || "tudo bem";
    // A pesquisa nasce antes do envio, já com a lista de unidades que o responsável vai ver.
    const sentAt = Date.now();
    const { data: survey, error: surveyErr } = await admin
      .from("fa_crm_nps_surveys")
      .insert({
        contact_id: c.id,
        channel_id: c.channel_id,
        sent_by_employee_id: employee?.id ?? null,
        sent_at_ms: sentAt,
        unit_options: unitOptions,
      })
      .select("id")
      .single();
    if (surveyErr || !survey) {
      console.error("Falha ao criar pesquisa NPS:", c.id, surveyErr?.message);
      result.failed++;
      continue;
    }
    const form = new URLSearchParams({
      From: `whatsapp:${channel.whatsapp_e164}`,
      To: `whatsapp:${c.phone_e164}`,
      ContentSid: template.content_sid,
      ContentVariables: JSON.stringify(npsVariables(firstName, unitOptions)),
      StatusCallback: WEBHOOK_URL,
    });

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
      console.error("Twilio recusou NPS:", c.id, out?.code, out?.message);
      await admin.from("fa_crm_nps_surveys").delete().eq("id", survey.id);
      result.failed++;
      continue;
    }

    await admin.from("fa_crm_messages").insert({
      contact_id: c.id,
      direction: "OUT",
      body: renderNpsPreview(template.preview, firstName, unitOptions),
      twilio_sid: out.sid,
      status: "queued",
      template_id: template.id,
      sent_by_employee_id: employee?.id ?? null,
      created_at_ms: sentAt,
    });
    await admin
      .from("fa_crm_contacts")
      .update({ last_message_ms: sentAt, last_message_preview: "Você: pesquisa de NPS enviada" })
      .eq("id", c.id);
    result.sent++;
  }

  return jsonResponse(req, { ok: true, ...result });
});
