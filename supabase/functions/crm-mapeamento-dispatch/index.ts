import { createClient } from "jsr:@supabase/supabase-js@2";

// Disparada de hora em hora pelo pg_cron (migration 20260928200000). Uma
// semana depois da visita, convida o responsável — UMA ÚNICA VEZ — a fazer o
// Mapeamento Comportamental gratuito do Instituto, tocando na "dor" da família
// e na promessa do FaçaAmigos. SOMENTE unidades com
// fa_kiosk_app_settings.crm_mapeamento_followup = '1' e responsáveis com aceite
// de contato (fa_crm_mapeamento_candidates filtra). Sem aceite/canal/template:
// não envia.
//
// verify_jwt = false (config.toml): só o pg_cron chama. Rodar a mais não envia
// a mais: fa_crm_mapeamento_invites.guardian_id é unique e é gravada ANTES do
// envio. Inline (sem _shared) pelo mesmo motivo de crm-visit-notify-dispatch.

const MAX_PER_RUN = 40;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";
// Mesma landing do MapeamentoBanner da tela pública, com utm próprio do canal.
const MAPEAMENTO_URL =
  Deno.env.get("MAPEAMENTO_URL") ??
  "https://institutofacaamigos.com.br/teste?utm_source=whatsapp&utm_medium=crm&utm_campaign=mapeamento&utm_content=followup-7d";

interface Candidate {
  session_id: string;
  unit_id: string;
  guardian_id: string;
  guardian_name: string | null;
  phone_e164: string;
  child_first_name: string | null;
  child_age_years: number | null;
  activity: string;
}

/**
 * A "dor" ({{3}} do template MAPEAMENTO): uma frase curta, por faixa etária da
 * criança, que nomeia o que costuma preocupar a família nessa idade — a ponte
 * entre a visita e o convite ao Mapeamento. Sem quebra de linha (o WhatsApp não
 * aceita em variável) e sem linguagem clínica (mesma regra do relatório de
 * sessão: nada de transtorno, déficit, diagnóstico). Devolver null pula o
 * convite daquela família — enquanto devolver null para tudo, nada sai.
 *
 * TODO(human): definir as faixas e escrever a frase de cada uma.
 * `ageYears` pode ser null (sessão sem criança cadastrada).
 */
function painHook(_ageYears: number | null, _childFirst: string): string | null {
  return null;
}

/** Variáveis do template: {{1}} responsável, {{2}} criança, {{3}} dor, {{4}} link; null = pula. */
function variablesFor(c: Candidate): Record<string, string> | null {
  const guardian = (c.guardian_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const child = c.child_first_name || "seu filho(a)";
  const pain = painHook(c.child_age_years, child);
  return pain ? { "1": guardian, "2": child, "3": pain, "4": MAPEAMENTO_URL } : null;
}

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
    .eq("purpose", "MAPEAMENTO")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return json({ ok: true, skipped: "sem template MAPEAMENTO ativo" });

  const { data: channels } = await admin
    .from("fa_crm_channels")
    .select("id, label, whatsapp_e164")
    .eq("active", true)
    .eq("is_sandbox", false);
  if (!channels?.length) return json({ ok: true, skipped: "sem canal ativo" });
  // Uma marca por número: o label decide (Circuito = carrinhos, o resto = Playground).
  const channelFor = (activity: string) =>
    channels.find((c) => c.label.toLowerCase().includes("circuito") === (activity === "CARRINHO"));

  const { data: candidates, error } = await admin.rpc("fa_crm_mapeamento_candidates", { p_now_ms: Date.now() });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of ((candidates ?? []) as Candidate[]).slice(0, MAX_PER_RUN)) {
    const channel = channelFor(cand.activity);
    const variables = variablesFor(cand);
    if (!channel || !variables) {
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

    // Trava do "uma única vez": quem inserir primeiro envia; o resto pula.
    const { data: claim, error: claimErr } = await admin
      .from("fa_crm_mapeamento_invites")
      .insert({ guardian_id: cand.guardian_id, session_id: cand.session_id, contact_id: contact!.id, channel_id: channel.id })
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
        // Falha transitória: solta a trava para a próxima hora tentar de novo
        // (a janela de 7-9 dias ainda está aberta).
        await admin.from("fa_crm_mapeamento_invites").delete().eq("id", claim.id);
      } else {
        // Recusa definitiva (template/número inválido): registra e não insiste —
        // o responsável fica marcado como "convidado", ninguém recebe duas vezes.
        console.error("Twilio recusou convite ao Mapeamento:", out?.code, out?.message);
        await admin.from("fa_crm_mapeamento_invites").update({ error: `Twilio ${out?.code ?? res.status}` }).eq("id", claim.id);
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
      .update({ last_message_ms: sentAt, last_message_preview: "Você: convite ao Mapeamento enviado" })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, candidates: candidates?.length ?? 0, sent, skipped, failed });
});
