import { createClient } from "jsr:@supabase/supabase-js@2";

// Campanha de opt-in de MARKETING (migration 20260929010000). Disparada de
// hora em hora (10h-19h de Belém) pelo pg_cron. Envia UMA mensagem por
// responsável perguntando se aceita receber ofertas — só para quem JÁ aceitou
// contato geral (fa_crm_optin_campaign); sem isso os kinds MARKETING do
// catálogo (fa_crm_lc_candidates) nunca encontram candidato.
//
// Mesmo desenho de crm-optin-dispatch: nasce PAUSED (Owner inicia na aba CRM
// WhatsApp), teto diário = daily_cap, freio automático (>3% PARAR ou >20%
// falha em 24h pausa sozinho), fa_crm_marketing_optin_requests.guardian_id
// único evita reenvio.
//
// verify_jwt = false (config.toml): só o pg_cron chama.

const DAY_MS = 24 * 60 * 60 * 1000;
const BELEM_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3, sem horário de verão
const PER_RUN = 2; // 10 rodadas/dia x 2 = 20
const OPT_OUT_RATE_LIMIT = 0.03;
const FAILURE_RATE_LIMIT = 0.2;
const MIN_SAMPLE = 10;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await admin.from("fa_crm_marketing_optin_config").select("status, daily_cap").eq("id", 1).single();
  if (!cfg || cfg.status !== "RUNNING") return json({ ok: true, skipped: "pausada" });

  const now = Date.now();
  const belem = new Date(now - BELEM_OFFSET_MS);
  const hour = belem.getUTCHours();
  if (hour < 10 || hour >= 20) return json({ ok: true, skipped: "fora do horário" });
  const startOfDayMs = Date.UTC(belem.getUTCFullYear(), belem.getUTCMonth(), belem.getUTCDate()) + BELEM_OFFSET_MS;

  // ── Freio automático ──
  const { data: last24 } = await admin
    .from("fa_crm_marketing_optin_requests")
    .select("status, twilio_sid")
    .gte("sent_at_ms", now - DAY_MS);
  const sent24 = last24?.length ?? 0;
  if (sent24 >= MIN_SAMPLE) {
    const declined = last24!.filter((r) => r.status === "DECLINED").length;
    const sids = last24!.map((r) => r.twilio_sid).filter(Boolean) as string[];
    const { count: failed } = await admin
      .from("fa_crm_messages")
      .select("id", { count: "exact", head: true })
      .in("twilio_sid", sids)
      .in("status", ["failed", "undelivered"]);
    const reason =
      declined / sent24 > OPT_OUT_RATE_LIMIT
        ? `freio automático: ${declined} pedidos de PARAR em ${sent24} envios (>${OPT_OUT_RATE_LIMIT * 100}%)`
        : (failed ?? 0) / sent24 > FAILURE_RATE_LIMIT
          ? `freio automático: ${failed} falhas de entrega em ${sent24} envios (>${FAILURE_RATE_LIMIT * 100}%)`
          : null;
    if (reason) {
      await admin.from("fa_crm_marketing_optin_config").update({ status: "PAUSED", paused_reason: reason, updated_at_ms: now }).eq("id", 1);
      console.error(reason);
      return json({ ok: true, paused: reason });
    }
  }

  // ── Teto do dia ──
  const { count: sentToday } = await admin
    .from("fa_crm_marketing_optin_requests")
    .select("id", { count: "exact", head: true })
    .gte("sent_at_ms", startOfDayMs);
  const room = cfg.daily_cap - (sentToday ?? 0);
  if (room <= 0) return json({ ok: true, skipped: "teto do dia atingido" });

  const { data: template } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview")
    .eq("purpose", "OPTIN_MARKETING")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return json({ ok: true, skipped: "sem template OPTIN_MARKETING ativo" });

  const { data: channels } = await admin
    .from("fa_crm_channels")
    .select("id, label, whatsapp_e164")
    .eq("active", true)
    .eq("is_sandbox", false);
  if (!channels?.length) return json({ ok: true, skipped: "sem canal ativo" });
  const channelFor = (activity: string) =>
    channels.find((c) => c.label.toLowerCase().includes("circuito") === (activity === "CARRINHO")) ??
    // Circuito e Playground compartilham o mesmo número: com um único canal, ele atende qualquer atividade.
    (channels.length === 1 ? channels[0] : undefined);

  const { data: candidates, error } = await admin.rpc("fa_crm_marketing_optin_candidates", { p_limit: Math.min(PER_RUN, room) });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let failed = 0;

  for (const cand of candidates ?? []) {
    const channel = channelFor(cand.activity);
    if (!channel) continue;

    let { data: contact } = await admin
      .from("fa_crm_contacts")
      .select("id, name")
      .eq("channel_id", channel.id)
      .eq("phone_e164", cand.phone_e164)
      .maybeSingle();
    if (!contact) {
      const { data: created, error: insErr } = await admin
        .from("fa_crm_contacts")
        .insert({ channel_id: channel.id, phone_e164: cand.phone_e164, name: cand.full_name, guardian_id: cand.guardian_id })
        .select("id, name")
        .single();
      if (insErr) {
        failed++;
        continue;
      }
      contact = created;
    }

    const sentAt = Date.now();
    const { data: reservation, error: resErr } = await admin
      .from("fa_crm_marketing_optin_requests")
      .insert({ guardian_id: cand.guardian_id, contact_id: contact!.id, channel_id: channel.id, sent_at_ms: sentAt })
      .select("id")
      .single();
    if (resErr) continue;

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
      console.error("Twilio recusou opt-in de marketing:", out?.code, out?.message);
      await admin.from("fa_crm_marketing_optin_requests").delete().eq("id", reservation.id);
      failed++;
      continue;
    }

    await admin.from("fa_crm_marketing_optin_requests").update({ twilio_sid: out.sid }).eq("id", reservation.id);
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
      .update({ last_message_ms: sentAt, last_message_preview: "Você: pedido de autorização de marketing enviado" })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, sent, failed, sentToday: (sentToday ?? 0) + sent });
});
