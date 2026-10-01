import { createClient } from "jsr:@supabase/supabase-js@2";

// Disparada a cada 15 min pelo pg_cron (migration 20260928140000). Envia o
// NPS por WhatsApp a quem terminou a visita entre 2h e 6h atrás, SOMENTE nas
// unidades com fa_kiosk_app_settings.crm_nps_auto = '1' (padrão desligado).
//
// verify_jwt = false (config.toml): só o pg_cron chama, sem JWT — mesmo
// padrão de sales-compendium-dispatch. Rodar a mais não causa envio a
// mais: a janela de checkout é fixa e há cooldown de 30 dias por contato.
// Inline (sem _shared) pelo mesmo motivo das demais functions de cron.

const MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 50;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: template } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview")
    .eq("purpose", "NPS")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return json({ ok: true, skipped: "sem template NPS ativo" });

  const { data: channels } = await admin
    .from("fa_crm_channels")
    .select("id, label, whatsapp_e164")
    .eq("active", true)
    .eq("is_sandbox", false);
  if (!channels?.length) return json({ ok: true, skipped: "sem canal ativo" });
  // Uma marca por número: o label decide (Circuito = carrinhos, o resto = Playground).
  const channelFor = (activity: string) =>
    channels.find((c) => c.label.toLowerCase().includes("circuito") === (activity === "CARRINHO")) ??
    // Circuito e Playground compartilham o mesmo número: com um único canal, ele atende qualquer atividade.
    (channels.length === 1 ? channels[0] : undefined);

  const now = Date.now();
  const { data: candidates, error } = await admin.rpc("fa_crm_nps_candidates", {
    p_from_ms: now - MAX_AGE_MS,
    p_to_ms: now - MIN_DELAY_MS,
  });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of (candidates ?? []).slice(0, MAX_PER_RUN)) {
    const channel = channelFor(cand.activity);
    if (!channel) {
      skipped++;
      continue;
    }

    // Garante o contato (respeitando quem já pediu PARAR).
    let { data: contact } = await admin
      .from("fa_crm_contacts")
      .select("id, name, opt_in")
      .eq("channel_id", channel.id)
      .eq("phone_e164", cand.phone_e164)
      .maybeSingle();
    if (!contact) {
      const { data: created, error: insErr } = await admin
        .from("fa_crm_contacts")
        .insert({ channel_id: channel.id, phone_e164: cand.phone_e164, name: cand.full_name, guardian_id: cand.guardian_id })
        .select("id, name, opt_in")
        .single();
      if (insErr) {
        failed++;
        continue;
      }
      contact = created;
    }
    if (!contact!.opt_in) {
      skipped++;
      continue;
    }

    const { data: recent } = await admin
      .from("fa_crm_nps_surveys")
      .select("id")
      .eq("contact_id", contact!.id)
      .gte("sent_at_ms", now - COOLDOWN_MS)
      .limit(1);
    if (recent?.length) {
      skipped++;
      continue;
    }

    const firstName = (contact!.name ?? cand.full_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: `whatsapp:${channel.whatsapp_e164}`,
        To: `whatsapp:${cand.phone_e164}`,
        ContentSid: template.content_sid,
        ContentVariables: JSON.stringify({ "1": firstName }),
        StatusCallback: WEBHOOK_URL,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Twilio recusou NPS automático:", out?.code, out?.message);
      failed++;
      continue;
    }

    const sentAt = Date.now();
    await admin.from("fa_crm_nps_surveys").insert({ contact_id: contact!.id, channel_id: channel.id, sent_at_ms: sentAt });
    await admin.from("fa_crm_messages").insert({
      contact_id: contact!.id,
      direction: "OUT",
      body: template.preview.replace(/\{\{1\}\}/g, firstName),
      twilio_sid: out.sid,
      status: "queued",
      template_id: template.id,
      created_at_ms: sentAt,
    });
    await admin
      .from("fa_crm_contacts")
      .update({ last_message_ms: sentAt, last_message_preview: "Você: pesquisa de NPS enviada" })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, candidates: candidates?.length ?? 0, sent, skipped, failed });
});
