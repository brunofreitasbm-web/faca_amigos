import { createClient } from "jsr:@supabase/supabase-js@2";

// Disparada a cada minuto pelo pg_cron (migration 20260928160000). Avisa por
// WhatsApp o responsável cuja sessão está perto do fim e oferece renovar com
// 3 botões de resposta rápida. SOMENTE unidades com
// fa_kiosk_app_settings.crm_renewal_alert = '1' e responsáveis com aceite de
// contato (fa_crm_renewal_candidates filtra). Sem aceite/canal/template: não envia.
//
// verify_jwt = false (config.toml): só o pg_cron chama. Rodar a mais não envia
// a mais: fa_crm_renewal_alerts.session_id é unique e é gravado ANTES do envio.
// Inline (sem _shared) pelo mesmo motivo das demais functions de cron.

const MAX_PER_RUN = 30;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

interface Option {
  minutes: number;
  cents: number;
}

// Gêmeo das tabelas de preço do painel (apps/kiosk-ui/src/screens/acompanhar/
// copy.ts e copyCircuito.ts) — mudou lá, muda aqui. O valor enviado fica
// congelado em fa_crm_renewal_alerts.options.
const PLAYGROUND_OPTIONS: Option[] = [
  { minutes: 30, cents: 4800 },
  { minutes: 60, cents: 9600 },
];

// O template tem 2 botões fixos ("+30 min" e "+60 min"), que são os do
// Playground. O Circuito tem outras durações, então não recebe a oferta.
const optionsFor = (activity: string, _assetKind: string | null, _durationMinutes: number): Option[] | null =>
  activity === "CARRINHO" ? null : PLAYGROUND_OPTIONS;

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

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
    .eq("purpose", "RENOVACAO")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return json({ ok: true, skipped: "sem template de renovação ativo" });

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

  const { data: candidates, error } = await admin.rpc("fa_crm_renewal_candidates", { p_now_ms: Date.now() });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of (candidates ?? []).slice(0, MAX_PER_RUN)) {
    const channel = channelFor(cand.activity);
    const options = optionsFor(cand.activity, cand.asset_kind, cand.duration_minutes);
    if (!channel || !options) {
      skipped++;
      continue;
    }

    let { data: contact } = await admin
      .from("fa_crm_contacts")
      .select("id, name, opt_in")
      .eq("channel_id", channel.id)
      .eq("phone_e164", cand.phone_e164)
      .maybeSingle();
    if (!contact) {
      const { data: created, error: insErr } = await admin
        .from("fa_crm_contacts")
        .insert({ channel_id: channel.id, phone_e164: cand.phone_e164, name: cand.guardian_name, guardian_id: cand.guardian_id })
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

    // Trava: quem inserir primeiro envia; o resto (cron sobreposto) pula.
    const { data: claim, error: claimErr } = await admin
      .from("fa_crm_renewal_alerts")
      .insert({ session_id: cand.session_id, contact_id: contact!.id, channel_id: channel.id, options })
      .select("id")
      .single();
    if (claimErr || !claim) {
      skipped++;
      continue;
    }

    const guardianFirst = (contact!.name ?? cand.guardian_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
    const child = cand.child_first_name || "seu filho(a)";
    // Newline não é permitido em variável de template do WhatsApp.
    const optionsText = options.map((o) => `+${o.minutes} min por ${brl(o.cents)}`).join(" ou ");
    const variables = { "1": guardianFirst, "2": child, "3": optionsText };

    let res: Response | null = null;
    let out: { sid?: string; code?: number; message?: string } = {};
    try {
      res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: `whatsapp:${channel.whatsapp_e164}`,
          To: `whatsapp:${cand.phone_e164}`,
          ContentSid: template.content_sid,
          ContentVariables: JSON.stringify(variables),
          StatusCallback: WEBHOOK_URL,
        }),
      });
      out = await res.json().catch(() => ({}));
    } catch (e) {
      console.error("Twilio inacessível:", e);
    }

    if (!res || !res.ok) {
      failed++;
      if (!res || res.status >= 500) {
        // Falha transitória: solta a trava para o próximo minuto tentar de novo
        // (a janela da sessão ainda está aberta).
        await admin.from("fa_crm_renewal_alerts").delete().eq("id", claim.id);
      } else {
        // Recusa definitiva (template/número inválido): registra e não insiste.
        console.error("Twilio recusou aviso de renovação:", out?.code, out?.message);
        await admin.from("fa_crm_renewal_alerts").update({ error: `Twilio ${out?.code ?? res.status}` }).eq("id", claim.id);
      }
      continue;
    }

    const sentAt = Date.now();
    await admin.from("fa_crm_messages").insert({
      contact_id: contact!.id,
      direction: "OUT",
      body: template.preview.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => (variables as Record<string, string>)[n] ?? ""),
      twilio_sid: out.sid,
      status: "queued",
      template_id: template.id,
      created_at_ms: sentAt,
    });
    await admin
      .from("fa_crm_contacts")
      .update({ last_message_ms: sentAt, last_message_preview: "Você: aviso de fim de plano enviado" })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, candidates: candidates?.length ?? 0, sent, skipped, failed });
});
