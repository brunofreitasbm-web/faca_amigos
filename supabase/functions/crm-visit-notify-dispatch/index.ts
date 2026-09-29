import { createClient } from "jsr:@supabase/supabase-js@2";

// Disparada a cada minuto pelo pg_cron (migration 20260928180000). Envia por
// WhatsApp quatro avisos da visita que a tela pública de acompanhamento já mostra:
// boas-vindas com o link, fim do plano (excedente), renovação aplicada e
// progresso do cartão fidelidade. SOMENTE unidades com o tipo ligado em
// fa_kiosk_app_settings (crm_notify_<tipo> = '1') e responsáveis com aceite de
// contato (fa_crm_visit_candidates filtra). Sem aceite/canal/template: não envia.
//
// verify_jwt = false (config.toml): só o pg_cron chama. Rodar a mais não envia a
// mais: fa_crm_visit_notifications (session_id, kind, ref_ms) é unique e é gravada
// ANTES do envio. Inline (sem _shared) pelo mesmo motivo das demais functions de
// cron: a trava-antes-do-envio precisa distinguir falha transitória de recusa.

const MAX_PER_RUN = 40;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";
const PUBLIC_APP_URL = (Deno.env.get("PUBLIC_APP_URL") ?? "https://app.institutofacaamigos.com.br").replace(/\/$/, "");

type Kind = "WELCOME" | "OVERAGE" | "RENEWAL_OK" | "LOYALTY";

interface Candidate {
  kind: Kind;
  session_id: string;
  ref_ms: number;
  guardian_id: string;
  guardian_name: string | null;
  phone_e164: string;
  child_first_name: string | null;
  activity: string;
  access_code: string | null;
  minutes: number | null;
  cents: number | null;
  visit_cycle: number | null;
}

const PURPOSE: Record<Kind, string> = {
  WELCOME: "VISITA_BOAS_VINDAS",
  OVERAGE: "VISITA_EXCEDENTE",
  RENEWAL_OK: "VISITA_RENOVACAO_OK",
  LOYALTY: "VISITA_FIDELIDADE",
};

const PREVIEW_LABEL: Record<Kind, string> = {
  WELCOME: "boas-vindas enviadas",
  OVERAGE: "aviso de fim do plano enviado",
  RENEWAL_OK: "confirmação de renovação enviada",
  LOYALTY: "aviso do cartão fidelidade enviado",
};

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

/**
 * Texto do cartão fidelidade (variável {{3}} do template VISITA_FIDELIDADE).
 * `cycle` é a posição da visita no ciclo de 10 (8, 9 ou 10). Sem quebra de
 * linha (o WhatsApp não aceita em variável).
 *
 * TEXTO PROVISÓRIO — publicado para destravar o envio, mas é conteúdo
 * voltado ao cliente e merece revisão/aprovação antes do template real ir
 * ao ar no Twilio (o template ainda não existe, então nada sai por ora).
 */
function loyaltyMessage(cycle: number, childFirst: string): string | null {
  if (cycle === 8) return `${childFirst} está a só 2 visitas de ganhar 30 min de cortesia! Continue vindo brincar.`;
  if (cycle === 9) return `${childFirst} está a 1 visita de ganhar 30 min de cortesia na próxima! Já pode aparecer.`;
  if (cycle === 10) return `Parabéns! ${childFirst} completou o ciclo — os 30 min de cortesia já saíram nesta visita.`;
  return null;
}

/** Variáveis do template ({{1}} responsável, {{2}} criança, {{3}} varia por tipo); null = pula. */
function variablesFor(c: Candidate): Record<string, string> | null {
  const guardian = (c.guardian_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const child = c.child_first_name || "seu filho(a)";
  let third: string | null;
  switch (c.kind) {
    case "WELCOME":
      third = c.access_code ? `${PUBLIC_APP_URL}/?acompanhar=${c.access_code}` : null;
      break;
    case "OVERAGE":
      third = c.cents ? brl(c.cents) : null;
      break;
    case "RENEWAL_OK":
      third = c.minutes ? `+${c.minutes} min` : null;
      break;
    case "LOYALTY":
      third = c.visit_cycle ? loyaltyMessage(c.visit_cycle, child) : null;
      break;
  }
  return third ? { "1": guardian, "2": child, "3": third } : null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Templates ativos por propósito (o mais recente de cada).
  const { data: tpls } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview, purpose")
    .in("purpose", Object.values(PURPOSE))
    .eq("active", true)
    .order("created_at_ms", { ascending: false });
  const templateByPurpose = new Map<string, { id: string; content_sid: string; preview: string }>();
  for (const t of tpls ?? []) if (!templateByPurpose.has(t.purpose)) templateByPurpose.set(t.purpose, t);
  if (!templateByPurpose.size) return json({ ok: true, skipped: "sem template de visita ativo" });

  const { data: channels } = await admin
    .from("fa_crm_channels")
    .select("id, label, whatsapp_e164")
    .eq("active", true)
    .eq("is_sandbox", false);
  if (!channels?.length) return json({ ok: true, skipped: "sem canal ativo" });
  // Uma marca por número: o label decide (Circuito = carrinhos, o resto = Playground).
  const channelFor = (activity: string) =>
    channels.find((c) => c.label.toLowerCase().includes("circuito") === (activity === "CARRINHO"));

  const { data: candidates, error } = await admin.rpc("fa_crm_visit_candidates", { p_now_ms: Date.now() });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of ((candidates ?? []) as Candidate[]).slice(0, MAX_PER_RUN)) {
    const template = templateByPurpose.get(PURPOSE[cand.kind]);
    const channel = channelFor(cand.activity);
    const variables = variablesFor(cand);
    if (!template || !channel || !variables) {
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
      .from("fa_crm_visit_notifications")
      .insert({ session_id: cand.session_id, kind: cand.kind, ref_ms: cand.ref_ms, contact_id: contact!.id, channel_id: channel.id })
      .select("id")
      .single();
    if (claimErr || !claim) {
      skipped++;
      continue;
    }

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
        // (a janela do aviso ainda está aberta).
        await admin.from("fa_crm_visit_notifications").delete().eq("id", claim.id);
      } else {
        // Recusa definitiva (template/número inválido): registra e não insiste.
        console.error(`Twilio recusou ${cand.kind}:`, out?.code, out?.message);
        await admin.from("fa_crm_visit_notifications").update({ error: `Twilio ${out?.code ?? res.status}` }).eq("id", claim.id);
      }
      continue;
    }

    const sentAt = Date.now();
    await admin.from("fa_crm_messages").insert({
      contact_id: contact!.id,
      direction: "OUT",
      body: template.preview.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => variables[n] ?? ""),
      twilio_sid: out.sid,
      status: "queued",
      template_id: template.id,
      created_at_ms: sentAt,
    });
    await admin
      .from("fa_crm_contacts")
      .update({ last_message_ms: sentAt, last_message_preview: `Você: ${PREVIEW_LABEL[cand.kind]}` })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, candidates: candidates?.length ?? 0, sent, skipped, failed });
});
