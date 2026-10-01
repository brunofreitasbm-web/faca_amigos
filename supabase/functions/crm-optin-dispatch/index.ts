import { createClient } from "jsr:@supabase/supabase-js@2";
import { dailyTarget, gapMs, nextRampLevel, runQuota, WINDOW_END_MIN, WINDOW_START_MIN } from "./pacing.ts";

// Campanha de opt-in da base atual (migrations 20260928165000 e
// 20261001120000). Disparada a cada 5 min (8h-20h de Belém) pelo pg_cron.
// Envia UMA mensagem por responsável perguntando se aceita contato por WhatsApp.
//
// Só age se fa_crm_optin_config.status = 'RUNNING' (nasce PAUSED; o Owner
// inicia na aba CRM WhatsApp). Nada de reenvio: fa_crm_optin_requests.guardian_id
// é único.
//
// Ritmo (pacing.ts): meta do dia em rampa (30, 45, 67, 101…), que só sobe se o
// último dia teve PARAR < 1,5%, ou o necessário para fechar a fila em
// deadline_days, nunca acima de daily_cap (máx. 150, check no banco). Cada
// rodada sorteia 0-2 envios, com pausa aleatória entre eles.
//
// Freio automático: nas últimas 24h, pausa se >3% pediram PARAR ou >20% das
// entregas falharam — sinais que a Meta usa para derrubar a nota de
// qualidade do número. Quem despausa é o Owner, depois de olhar.
//
// verify_jwt = false (config.toml): só o pg_cron chama. Inline (sem _shared)
// pelo mesmo motivo das demais functions de cron.

const DAY_MS = 24 * 60 * 60 * 1000;
const BELEM_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3, sem horário de verão
const OPT_OUT_RATE_LIMIT = 0.03;
const FAILURE_RATE_LIMIT = 0.2;
const MIN_SAMPLE = 10; // abaixo disso as taxas não significam nada
const WEBHOOK_URL =
  Deno.env.get("CRM_WEBHOOK_PUBLIC_URL") ?? "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await admin
    .from("fa_crm_optin_config")
    .select("status, daily_cap, started_at_ms, deadline_days, ramp_level, target_day_ms, today_target")
    .eq("id", 1)
    .single();
  if (!cfg || cfg.status !== "RUNNING") return json({ ok: true, skipped: "pausada" });

  const now = Date.now();
  const belem = new Date(now - BELEM_OFFSET_MS);
  const minuteOfDay = belem.getUTCHours() * 60 + belem.getUTCMinutes();
  if (minuteOfDay < WINDOW_START_MIN || minuteOfDay >= WINDOW_END_MIN) return json({ ok: true, skipped: "fora do horário" });
  const startOfDayMs = Date.UTC(belem.getUTCFullYear(), belem.getUTCMonth(), belem.getUTCDate()) + BELEM_OFFSET_MS;

  // ── Freio automático ──
  const { data: last24 } = await admin
    .from("fa_crm_optin_requests")
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
      await admin.from("fa_crm_optin_config").update({ status: "PAUSED", paused_reason: reason, updated_at_ms: now }).eq("id", 1);
      console.error(reason);
      return json({ ok: true, paused: reason });
    }
  }

  // ── Meta do dia (calculada na 1ª rodada do dia e guardada no config) ──
  let target = cfg.today_target as number;
  if (Number(cfg.target_day_ms) !== startOfDayMs) {
    let rampLevel = cfg.ramp_level as number;
    if (cfg.target_day_ms != null) {
      // Reação da base no último dia em que a meta valeu.
      const lastDay = Number(cfg.target_day_ms);
      const { data: lastRows } = await admin
        .from("fa_crm_optin_requests")
        .select("status")
        .gte("sent_at_ms", lastDay)
        .lt("sent_at_ms", lastDay + DAY_MS);
      const declined = (lastRows ?? []).filter((r) => r.status === "DECLINED").length;
      rampLevel = nextRampLevel(rampLevel, lastRows?.length ?? 0, declined);
    }
    const startedAt = cfg.started_at_ms != null ? Number(cfg.started_at_ms) : now;
    const startedDayMs = startedAt - ((startedAt - BELEM_OFFSET_MS) % DAY_MS + DAY_MS) % DAY_MS;
    const daysLeft = cfg.deadline_days - Math.round((startOfDayMs - startedDayMs) / DAY_MS);
    const { count: pending, error: pendingErr } = await admin.rpc(
      "fa_crm_optin_candidates",
      { p_limit: 100000 },
      { count: "exact", head: true },
    );
    if (pendingErr) {
      console.error("fila:", pendingErr);
      return json({ error: "falha ao contar a fila" }, 500);
    }
    target = dailyTarget(rampLevel, cfg.daily_cap, pending ?? 0, daysLeft);
    await admin
      .from("fa_crm_optin_config")
      .update({ ramp_level: rampLevel, target_day_ms: startOfDayMs, today_target: target, started_at_ms: startedAt })
      .eq("id", 1);
  }

  const { count: sentToday } = await admin
    .from("fa_crm_optin_requests")
    .select("id", { count: "exact", head: true })
    .gte("sent_at_ms", startOfDayMs);
  const quota = runQuota(target, sentToday ?? 0, minuteOfDay);
  if (quota <= 0) return json({ ok: true, skipped: "nada nesta rodada", target, sentToday });

  const { data: template } = await admin
    .from("fa_crm_templates")
    .select("id, content_sid, preview")
    .eq("purpose", "OPTIN")
    .eq("active", true)
    .order("created_at_ms", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return json({ ok: true, skipped: "sem template OPTIN ativo" });

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

  const { data: candidates, error } = await admin.rpc("fa_crm_optin_candidates", { p_limit: quota });
  if (error) {
    console.error("candidatos:", error);
    return json({ error: "falha ao buscar candidatos" }, 500);
  }

  let sent = 0;
  let failed = 0;

  for (const [i, cand] of (candidates ?? []).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs()));
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

    // Reserva o pedido ANTES de enviar: o índice único em guardian_id garante
    // que uma rodada concorrente nunca manda duas vezes para a mesma pessoa.
    const sentAt = Date.now();
    const { data: reservation, error: resErr } = await admin
      .from("fa_crm_optin_requests")
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
      console.error("Twilio recusou opt-in:", out?.code, out?.message);
      // Não conta como enviado: libera a reserva para uma próxima rodada.
      await admin.from("fa_crm_optin_requests").delete().eq("id", reservation.id);
      failed++;
      continue;
    }

    await admin.from("fa_crm_optin_requests").update({ twilio_sid: out.sid }).eq("id", reservation.id);
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
      .update({ last_message_ms: sentAt, last_message_preview: "Você: pedido de autorização enviado" })
      .eq("id", contact!.id);
    sent++;
  }

  return json({ ok: true, sent, failed, target, sentToday: (sentToday ?? 0) + sent });
});
