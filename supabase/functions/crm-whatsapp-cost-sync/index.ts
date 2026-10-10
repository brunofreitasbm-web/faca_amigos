import { createClient } from "jsr:@supabase/supabase-js@2";

// Custo do WhatsApp (migration 20261009130002). Roda a cada 30 min (pg_cron):
//   1) Preço: a Twilio só informa o preço da mensagem depois da entrega. Busca
//      o Message de cada OUT já enviada/entregue/lida sem preço e grava
//      price (valor absoluto) e price_unit em fa_crm_messages.
//   2) Categoria: confere na Meta (Content API → ApprovalRequests) a categoria
//      que cada template ativo tem DE FATO — a Meta pode reclassificar um
//      template Utility como Marketing, e a cobrança segue a categoria dela.
//
// verify_jwt = false (config.toml): só o pg_cron chama; a function só lê da
// Twilio e grava nos dois campos acima. Inline pelo mesmo motivo das demais.

const CONTENT_API = "https://content.twilio.com/v1/Content";
const BATCH = 80;
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // depois disso a Twilio já não vai preencher
const MIN_AGE_MS = 10 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const accountSid = Deno.env.get("TWILIO_CRM_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_CRM_AUTH_TOKEN");
  if (!accountSid || !authToken) return json({ error: "Twilio do CRM não configurado" }, 503);
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = Date.now();

  // ── 1. Preço ──
  const { data: pending } = await admin
    .from("fa_crm_messages")
    .select("id, twilio_sid")
    .eq("direction", "OUT")
    .not("twilio_sid", "is", null)
    .is("price_synced_at_ms", null)
    .in("status", ["sent", "delivered", "read"])
    .lt("created_at_ms", now - MIN_AGE_MS)
    .gt("created_at_ms", now - MAX_AGE_MS)
    .order("created_at_ms", { ascending: false })
    .limit(BATCH);

  let priced = 0;
  let waiting = 0;
  for (const m of pending ?? []) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${m.twilio_sid}.json`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) continue;
    const out = await res.json().catch(() => null);
    if (out?.price == null || out.price === "") {
      waiting++; // ainda não faturada; tenta de novo na próxima rodada
      continue;
    }
    await admin
      .from("fa_crm_messages")
      .update({ price: Math.abs(Number(out.price)), price_unit: out.price_unit ?? null, price_synced_at_ms: now })
      .eq("id", m.id);
    priced++;
  }

  // ── 2. Categoria efetiva dos templates ──
  const { data: templates } = await admin
    .from("fa_crm_templates")
    .select("id, name, content_sid, category")
    .eq("active", true)
    .not("content_sid", "is", null);
  const reclassified: { name: string; declared: string | null; meta: string }[] = [];
  for (const t of templates ?? []) {
    const res = await fetch(`${CONTENT_API}/${t.content_sid}/ApprovalRequests`, { headers: { Authorization: auth } });
    if (!res.ok) continue;
    const out = await res.json().catch(() => null);
    const wa = out?.whatsapp;
    const metaCategory = typeof wa?.category === "string" ? wa.category.toUpperCase() : null;
    const patch: Record<string, unknown> = { category_checked_at_ms: now };
    if (typeof wa?.status === "string") patch.meta_status = wa.status.toLowerCase();
    if (metaCategory && ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(metaCategory)) {
      if (t.category && t.category !== metaCategory) reclassified.push({ name: t.name, declared: t.category, meta: metaCategory });
      patch.category = metaCategory;
    }
    await admin.from("fa_crm_templates").update(patch).eq("id", t.id);
  }
  if (reclassified.length) console.warn("templates reclassificados pela Meta:", JSON.stringify(reclassified));

  return json({ priced, waiting, templatesChecked: templates?.length ?? 0, reclassified });
});
