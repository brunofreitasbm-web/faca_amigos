import { createClient } from "jsr:@supabase/supabase-js@2";

// Disparada a cada 15 min pelo pg_cron (migration 20260929000000). Um único
// dispatcher para todas as automações de upsell/cross-sell/LTV/retenção —
// cada uma é um "kind" da RPC fa_crm_lc_candidates, mapeado para um purpose
// de template e uma flag por unidade (fa_kiosk_app_settings.crm_lc_<kind
// em minúsculo>). Nenhuma flag está ligada por padrão: cada automação só
// passa a valer quando alguém ligar explicitamente.
//
// Consentimento: kinds UTILITY já reaproveitam whatsapp_consent_at_ms
// (existente); kinds MARKETING exigem marketing_consent_at_ms (novo campo,
// ainda sem nenhum fluxo que o preencha) — ou seja, ficam inativos até o
// produto decidir como coletar esse aceite.
//
// Janela de envio: só das 10h às 20h de Belém (UTC-3), como o restante do
// CRM de marketing. Trava-antes-do-envio em fa_crm_automation_sends
// (unique kind+ref_key): 5xx solta a trava (tenta nos próximos 15 min),
// 4xx grava o erro e não insiste.

const MAX_PER_RUN = 60;
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";
const GOOGLE_REVIEW_URL = Deno.env.get("GOOGLE_REVIEW_URL") ?? "https://g.page/r/review";

type Kind =
  | "EXPIRACAO" | "RELATORIO_CUPOM" | "PREMIO_FIDELIDADE" | "NPS_PROMOTOR" | "NPS_DETRATOR"
  | "UPSELL_PACOTE" | "CROSS_ATIVIDADE" | "CROSS_IRMAO" | "ANIVERSARIO" | "VIP"
  | "WINBACK_1" | "WINBACK_2";

interface Candidate {
  kind: Kind;
  category: "MARKETING" | "UTILITY";
  unit_id: string | null;
  guardian_id: string;
  guardian_name: string | null;
  phone_e164: string;
  child_first_name: string | null;
  activity: string | null;
  ref_key: string;
  extra: Record<string, unknown> | null;
}

// kind -> purpose do template. WINBACK_1/2 compartilham o mesmo template
// (purpose WINBACK); o texto muda pelo próprio conteúdo do template.
const PURPOSE: Record<Kind, string> = {
  EXPIRACAO: "EXPIRACAO",
  RELATORIO_CUPOM: "RELATORIO_CUPOM",
  PREMIO_FIDELIDADE: "PREMIO_FIDELIDADE",
  NPS_PROMOTOR: "NPS_PROMOTOR",
  NPS_DETRATOR: "NPS_DETRATOR",
  UPSELL_PACOTE: "UPSELL_PACOTE",
  CROSS_ATIVIDADE: "CROSS_ATIVIDADE",
  CROSS_IRMAO: "CROSS_IRMAO",
  ANIVERSARIO: "ANIVERSARIO",
  VIP: "VIP",
  WINBACK_1: "WINBACK",
  WINBACK_2: "WINBACK",
};

const PREVIEW_LABEL: Record<Kind, string> = {
  EXPIRACAO: "aviso de saldo/validade enviado",
  RELATORIO_CUPOM: "cupom de retorno enviado",
  PREMIO_FIDELIDADE: "lembrete de prêmio enviado",
  NPS_PROMOTOR: "convite de avaliação enviado",
  NPS_DETRATOR: "aviso de contato enviado",
  UPSELL_PACOTE: "oferta de pacote enviada",
  CROSS_ATIVIDADE: "convite de outra atividade enviado",
  CROSS_IRMAO: "convite para o irmão enviado",
  ANIVERSARIO: "mensagem de aniversário enviada",
  VIP: "reconhecimento VIP enviado",
  WINBACK_1: "mensagem de saudade enviada",
  WINBACK_2: "cupom de retorno enviado",
};

const activityLabel = (a: string | null) => (a === "CARRINHO" ? "Circuito" : a === "PLAYGROUND" ? "Playground" : "");

/** Variáveis do template ({{1}} responsável, {{2}}/{{3}} variam por kind); null = pula. */
function variablesFor(c: Candidate): Record<string, string> | null {
  const guardian = (c.guardian_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const child = c.child_first_name || "seu filho(a)";
  const extra = c.extra ?? {};

  switch (c.kind) {
    case "EXPIRACAO": {
      const remaining = extra.remainingMinutes as number | null;
      const name = (extra.name as string | null) ?? (extra.sourceKind as string | null) ?? "seu saldo";
      const info = remaining != null && remaining <= 30 ? `restam ${remaining} min` : "está perto de vencer";
      return { "1": guardian, "2": name, "3": info };
    }
    case "RELATORIO_CUPOM":
      return { "1": guardian, "2": child, "3": "10% de desconto na próxima visita em até 14 dias" };
    case "PREMIO_FIDELIDADE":
      return { "1": guardian, "2": child };
    case "NPS_PROMOTOR":
      return { "1": guardian, "2": GOOGLE_REVIEW_URL };
    case "NPS_DETRATOR":
      return { "1": guardian };
    case "UPSELL_PACOTE":
      return { "1": guardian, "2": child };
    case "CROSS_ATIVIDADE":
      return { "1": guardian, "2": child, "3": activityLabel((extra.targetActivity as string | null) ?? null) };
    case "CROSS_IRMAO":
      return { "1": guardian, "2": child };
    case "ANIVERSARIO":
      return { "1": guardian, "2": child };
    case "VIP":
      return { "1": guardian, "2": child };
    case "WINBACK_1":
    case "WINBACK_2":
      return { "1": guardian };
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 10h-20h em Belém (UTC-3), sem depender de timezone do runtime. */
function withinSendWindow(nowMs: number): boolean {
  const belemHour = (Math.floor(nowMs / 3600000) - 3 + 24) % 24;
  return belemHour >= 10 && belemHour < 20;
}

Deno.serve(async () => {
  const now = Date.now();
  if (!withinSendWindow(now)) return json({ ok: true, skipped: "fora da janela de envio (10h-20h Belém)" });

  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: tpls } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview, purpose")
    .in("purpose", [...new Set(Object.values(PURPOSE))])
    .eq("active", true)
    .order("created_at_ms", { ascending: false });
  const templateByPurpose = new Map<string, { id: string; content_sid: string; preview: string }>();
  for (const t of tpls ?? []) if (!templateByPurpose.has(t.purpose)) templateByPurpose.set(t.purpose, t);
  if (!templateByPurpose.size) return json({ ok: true, skipped: "nenhum template de ciclo de vida ativo" });

  const { data: channels } = await admin
    .from("fa_crm_channels")
    .select("id, unit_id, label, whatsapp_e164")
    .eq("active", true)
    .eq("is_sandbox", false);
  if (!channels?.length) return json({ ok: true, skipped: "sem canal ativo" });
  const channelFor = (unitId: string | null) =>
    (unitId && channels.find((c) => c.unit_id === unitId)) || channels.find((c) => c.unit_id == null) || channels[0];

  const { data: candidates, error } = await admin.rpc("fa_crm_lc_candidates", { p_now_ms: now });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const cand of ((candidates ?? []) as Candidate[]).slice(0, MAX_PER_RUN)) {
    const template = templateByPurpose.get(PURPOSE[cand.kind]);
    const channel = channelFor(cand.unit_id);
    const variables = template && channel ? variablesFor(cand) : null;
    if (!template || !channel || !variables) {
      skipped++;
      continue;
    }

    // Flag por unidade (nasce desligada) — kinds sem unit_id claro (ex.:
    // NPS, prêmio) checam a flag em qualquer unidade que a tenha ligada.
    const settingKey = "crm_lc_" + cand.kind.toLowerCase();
    const { data: flagRows } = await admin
      .from("fa_kiosk_app_settings")
      .select("unit_id")
      .eq("key", settingKey)
      .eq("value", "1")
      .limit(1);
    if (!flagRows?.length) {
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

    const { data: canSend } = await admin.rpc("fa_crm_can_send", {
      p_contact_id: contact!.id, p_category: cand.category, p_now_ms: now,
    });
    if (canSend !== true) {
      skipped++;
      continue;
    }

    // Trava: quem inserir primeiro envia; o resto (execução sobreposta) pula.
    const { data: claim, error: claimErr } = await admin
      .from("fa_crm_automation_sends")
      .insert({
        unit_id: cand.unit_id, kind: cand.kind, contact_id: contact!.id, guardian_id: cand.guardian_id,
        ref_key: cand.ref_key, payload: cand.extra ?? {},
      })
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
        await admin.from("fa_crm_automation_sends").delete().eq("id", claim.id);
      } else {
        console.error(`Twilio recusou ${cand.kind}:`, out?.code, out?.message);
        await admin.from("fa_crm_automation_sends").update({ status: "FAILED", error: `Twilio ${out?.code ?? res.status}` }).eq("id", claim.id);
      }
      continue;
    }

    const sentAt = Date.now();
    await admin.from("fa_crm_automation_sends").update({ status: "SENT", twilio_sid: out.sid, sent_at_ms: sentAt }).eq("id", claim.id);
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
