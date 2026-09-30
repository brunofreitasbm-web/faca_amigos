import { createClient } from "jsr:@supabase/supabase-js@2";

// Function ADMINISTRATIVA, de uso único: registra um número como WhatsApp
// Sender via Twilio Messaging v2 API. Mesmas credenciais do CRM
// (TWILIO_CRM_ACCOUNT_SID/TWILIO_CRM_AUTH_TOKEN).
//
// Chamar SEM body (ou GET) -> diagnóstico: tipo de conta + senders existentes.
// Chamar com POST {"action":"register","phone":"+55..."} -> inicia registro
//   (Twilio manda OTP por SMS para o número).
// Chamar com POST {"action":"verify","senderSid":"XE...","code":"123456"} ->
//   confirma o OTP e finaliza o registro.

const API_BASE = "https://api.twilio.com/2010-04-01";
const MSG_BASE = "https://messaging.twilio.com/v2/Channels/Senders";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);

  // ── Conta PRINCIPAL (segredos TWILIO_MAIN_*, temporários) ──
  const url0 = new URL(req.url);
  const mainAction = url0.searchParams.get("main");
  if (mainAction) {
    const mainSid = Deno.env.get("TWILIO_MAIN_ACCOUNT_SID");
    const mainTok = Deno.env.get("TWILIO_MAIN_AUTH_TOKEN");
    if (!mainSid || !mainTok) return json({ error: "TWILIO_MAIN_ACCOUNT_SID/TWILIO_MAIN_AUTH_TOKEN não configurados" }, 503);
    const mainAuth = "Basic " + btoa(`${mainSid}:${mainTok}`);
    const list = await fetch(`${MSG_BASE}?Channel=whatsapp&PageSize=50`, { headers: { Authorization: mainAuth } });
    const listed = await list.json().catch(() => ({}));
    const target = (listed?.senders ?? []).find((s: Record<string, string>) => s.sender_id === "whatsapp:+559193368623");
    if (mainAction === "list") {
      return json({ mainAccountSid: mainSid, http: list.status, senders: listed?.senders ?? listed });
    }
    if (mainAction === "delete") {
      // Só apaga exatamente o sender combinado.
      if (!target) return json({ error: "sender +559193368623 não encontrado na conta principal", senders: listed?.senders ?? listed }, 404);
      const del = await fetch(`${MSG_BASE}/${target.sid}`, { method: "DELETE", headers: { Authorization: mainAuth } });
      return json({ deletedSid: target.sid, http: del.status, body: await del.text() });
    }
  }

  let input: { action?: string; phone?: string; senderSid?: string; code?: string; wabaId?: string } = {};
  if (req.method === "POST") {
    try {
      input = await req.json();
    } catch {
      // segue vazio -> diagnóstico
    }
  }

  if (input.action === "register" && input.phone) {
    const res = await fetch(`${MSG_BASE}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_id: `whatsapp:${input.phone}`, verification_method: "sms",
        ...(input.wabaId ? { waba_id: input.wabaId } : {}),
      }),
    });
    const out = await res.json().catch(() => ({}));
    return json({ ok: res.ok, httpStatus: res.status, result: out });
  }

  if (input.action === "verify" && input.senderSid && input.code) {
    const res = await fetch(`${MSG_BASE}/${input.senderSid}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ VerificationCode: input.code }),
    });
    const out = await res.json().catch(() => ({}));
    return json({ ok: res.ok, httpStatus: res.status, result: out });
  }

  // ── Diagnóstico ──
  const acctRes = await fetch(`${API_BASE}/Accounts/${accountSid}.json`, { headers: { Authorization: auth } });
  const acct = await acctRes.json().catch(() => ({}));

  const sendersRes = await fetch(`${MSG_BASE}?Channel=whatsapp`, { headers: { Authorization: auth } });
  const senders = await sendersRes.json().catch(() => ({}));

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: channels } = await admin.from("fa_crm_channels").select("*");

  const allAcctRes = await fetch(`${API_BASE}/Accounts.json?PageSize=50`, { headers: { Authorization: auth } });
  const allAcct = await allAcctRes.json().catch(() => ({}));

  // Variantes de listagem (somente leitura) para achar o sender Online.
  const probes: Record<string, unknown> = {};
  for (const url of [
    `${MSG_BASE}?Channel=whatsapp&PageSize=50`,
    `${MSG_BASE}?Channel=whatsapp&Status=ONLINE`,
    `${MSG_BASE}/whatsapp:+559193368623`,
    "https://messaging.twilio.com/v1/Channels/Senders?Channel=whatsapp",
  ]) {
    const r = await fetch(url, { headers: { Authorization: auth } });
    probes[url] = { http: r.status, body: await r.json().catch(() => null) };
  }

  return json({
    probes,
    accountType: acct?.type, accountStatus: acct?.status, accountSid: acct?.sid,
    friendlyName: acct?.friendly_name, ownerAccountSid: acct?.owner_account_sid,
    isSubaccount: acct?.owner_account_sid && acct?.owner_account_sid !== acct?.sid,
    visibleAccounts: (allAcct?.accounts ?? []).map((a: Record<string, string>) => ({ sid: a.sid, name: a.friendly_name, status: a.status })),
    sendersHttpStatus: sendersRes.status,
    existingSenders: senders?.senders ?? senders,
    existingChannelsInDb: channels ?? [],
  });
});
