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

  let input: { action?: string; phone?: string; senderSid?: string; code?: string } = {};
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
      body: JSON.stringify({ sender_id: `whatsapp:${input.phone}`, verification_method: "sms" }),
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

  return json({
    accountType: acct?.type, accountStatus: acct?.status, accountSid: acct?.sid,
    existingSenders: senders?.senders ?? senders,
    existingChannelsInDb: channels ?? [],
  });
});
