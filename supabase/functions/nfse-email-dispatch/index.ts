// Envia por e-mail (Resend) o comprovante de NFS-e ao Responsável, depois
// que o documento vira AUTORIZADO na fila (fa_kiosk_fiscal_docs).
//
// Chamada pelo worker do kiosk (apps/kiosk/src/fiscal/nfse.ts) logo após
// gravar o status — nunca pelo navegador, por isso não usa
// requireCapability (mesmo raciocínio de owner-report-dispatch: só o
// worker, autenticado com service role, invoca esta function).
//
// Igual à NFC-e, a transmissão REAL à prefeitura de Belém ainda não
// existe (layout do sistema próprio do município pendente de
// confirmação) — então hoje isto roda em cima de documentos SIMULADOS.
// O comprovante deixa isso explícito no rodapé pra nunca ser confundido
// com uma NFS-e homologada de verdade.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";

interface DispatchBody {
  fiscalDocId: string;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function receiptHtml(params: {
  unitRazaoSocial: string;
  unitCnpj: string;
  guardianName: string;
  childName: string;
  orderCode: string;
  totalCents: number;
  numero: string | null;
  protocolo: string | null;
  ambiente: string;
  simulado: boolean;
}): string {
  const { unitRazaoSocial, unitCnpj, guardianName, childName, orderCode, totalCents, numero, protocolo, ambiente, simulado } = params;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h2 style="margin-bottom: 4px;">Comprovante de Nota Fiscal de Serviço</h2>
      <p style="color: #6b7280; margin-top: 0;">${unitRazaoSocial} — CNPJ ${unitCnpj}</p>
      ${simulado ? `<p style="background:#FEF3C7;color:#92400E;padding:10px 14px;border-radius:8px;border:1px solid #F59E0B;">
        Este comprovante foi gerado em ambiente de homologação/simulação — a emissão oficial junto à Prefeitura ainda depende da confirmação do layout do sistema municipal.
      </p>` : ""}
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding:4px 0;color:#6b7280;">Responsável</td><td style="padding:4px 0;text-align:right;">${guardianName}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Criança</td><td style="padding:4px 0;text-align:right;">${childName}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Pedido</td><td style="padding:4px 0;text-align:right;">${orderCode}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Número NFS-e</td><td style="padding:4px 0;text-align:right;">${numero ?? "—"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Protocolo</td><td style="padding:4px 0;text-align:right;">${protocolo ?? "—"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Ambiente</td><td style="padding:4px 0;text-align:right;">${ambiente}</td></tr>
        <tr><td style="padding:8px 0;font-weight:bold;">Valor</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${money(totalCents)}</td></tr>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">FaçaAmigos — Playground Inclusivo</p>
    </div>
  `;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!resendKey || !resendFrom || !supabaseUrl || !serviceKey) {
    return jsonResponse(req, { error: "envio de e-mail fiscal não configurado neste ambiente" }, 503);
  }

  let body: DispatchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!body.fiscalDocId) return jsonResponse(req, { error: "envie fiscalDocId" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: doc, error: docError } = await admin
    .from("fa_kiosk_fiscal_docs")
    .select("id, order_id, unit_id, doc_type, environment, status, total_cents, nfse_numero, protocol_number, guardian_email_sent_at_ms")
    .eq("id", body.fiscalDocId)
    .maybeSingle();
  if (docError || !doc) return jsonResponse(req, { error: "documento fiscal não encontrado" }, 404);
  if (doc.doc_type !== "NFSE") return jsonResponse(req, { error: "documento não é NFS-e" }, 400);
  if (doc.status !== "AUTORIZADO") return jsonResponse(req, { error: "documento ainda não autorizado" }, 409);
  if (doc.guardian_email_sent_at_ms) return jsonResponse(req, { ok: true, alreadySent: true });

  const { data: unit } = await admin.from("fa_kiosk_units").select("razao_social, nome_fantasia, cnpj").eq("id", doc.unit_id).maybeSingle();
  const { data: order } = await admin.from("fa_kiosk_orders").select("order_code").eq("id", doc.order_id).maybeSingle();
  const { data: session } = await admin
    .from("fa_kiosk_sessions")
    .select("child_name_snapshot, guardian_name_snapshot, guardian_id")
    .eq("order_id", doc.order_id)
    .order("checkin_at_ms", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!session?.guardian_id) {
    await admin.from("fa_kiosk_fiscal_doc_events").insert({
      fiscal_doc_id: doc.id,
      kind: "EMAIL_FALHOU",
      detail_json: { motivo: "pedido sem sessão/responsável vinculado" },
    });
    return jsonResponse(req, { error: "pedido sem responsável vinculado para envio" }, 422);
  }

  const { data: guardian } = await admin.from("fa_kiosk_guardians").select("email, full_name").eq("id", session.guardian_id).maybeSingle();
  if (!guardian?.email) {
    await admin.from("fa_kiosk_fiscal_doc_events").insert({
      fiscal_doc_id: doc.id,
      kind: "EMAIL_FALHOU",
      detail_json: { motivo: "responsável sem e-mail cadastrado" },
    });
    return jsonResponse(req, { error: "responsável sem e-mail cadastrado" }, 422);
  }

  const html = receiptHtml({
    unitRazaoSocial: unit?.razao_social ?? unit?.nome_fantasia ?? "FaçaAmigos",
    unitCnpj: unit?.cnpj ?? "—",
    guardianName: guardian.full_name ?? session.guardian_name_snapshot ?? "Responsável",
    childName: session.child_name_snapshot ?? "—",
    orderCode: order?.order_code ?? "—",
    totalCents: doc.total_cents,
    numero: doc.nfse_numero,
    protocolo: doc.protocol_number,
    ambiente: doc.environment,
    simulado: (doc.protocol_number ?? "").startsWith("SIMULADO"),
  });

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resendFrom,
      to: guardian.email,
      subject: "Nota Fiscal de Serviço — FaçaAmigos",
      html,
    }),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text();
    await admin.from("fa_kiosk_fiscal_doc_events").insert({
      fiscal_doc_id: doc.id,
      kind: "EMAIL_FALHOU",
      http_status: resendResponse.status,
      detail_json: { detail },
    });
    return jsonResponse(req, { error: "falha ao enviar e-mail" }, 502);
  }

  await admin.from("fa_kiosk_fiscal_docs").update({ guardian_email_sent_at_ms: Date.now() }).eq("id", doc.id);
  await admin.from("fa_kiosk_fiscal_doc_events").insert({
    fiscal_doc_id: doc.id,
    kind: "EMAIL_ENVIADO",
    http_status: resendResponse.status,
  });

  return jsonResponse(req, { ok: true });
});
