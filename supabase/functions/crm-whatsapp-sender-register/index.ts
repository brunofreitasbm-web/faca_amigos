// Function ADMINISTRATIVA temporária (uso manual, sem cron): diagnóstico do sender
// de WhatsApp do CRM e consulta de aprovação de templates. Usa as credenciais do
// CRM (TWILIO_CRM_*). Somente leitura, exceto ?action=webhook (aponta o webhook
// do sender do Playground para o CRM).

const MSG_BASE = "https://messaging.twilio.com/v2/Channels/Senders";
const SENDER_SID = "XE1977d01f7122e03b17796161f279fff5"; // +559193368623 (Playground)
const WEBHOOK = "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const sid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const tok = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!sid || !tok) return json({ error: "Twilio do CRM não configurado" }, 503);
  const auth = "Basic " + btoa(`${sid}:${tok}`);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "approval") {
    const csid = url.searchParams.get("sid") ?? "";
    const r = await fetch(`https://content.twilio.com/v1/Content/${csid}/ApprovalRequests`, { headers: { Authorization: auth } });
    return json({ http: r.status, body: await r.json().catch(() => null) });
  }

  if (action === "webhook") {
    const res = await fetch(`${MSG_BASE}/${SENDER_SID}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook: { callback_url: WEBHOOK, callback_method: "POST", status_callback_url: WEBHOOK, status_callback_method: "POST" },
      }),
    });
    return json({ http: res.status, body: await res.json().catch(() => null) });
  }

  const res = await fetch(`${MSG_BASE}/${SENDER_SID}`, { headers: { Authorization: auth } });
  const s = await res.json().catch(() => ({}));
  return json({ http: res.status, accountSid: sid, status: s?.status, sender_id: s?.sender_id, webhook: s?.webhook, quality: s?.properties });
});
