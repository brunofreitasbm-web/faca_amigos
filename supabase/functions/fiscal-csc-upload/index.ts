// Cadastro do CSC (Código de Segurança do Contribuinte) da NFC-e pela tela
// Gerencial → Fiscal.
//
// O CSC tem duas partes: o `id` (ex. '000002'), que não é segredo e já
// morava em fa_kiosk_units.nfce_csc_id, e o `token` (36 caracteres), que é
// o que assina o QR Code da NFC-e — quem tem o token emite nota em nome da
// empresa. Até aqui o token só existia no cofre local do PC do balcão
// (apps/kiosk/src/fiscal/vault.ts); com o worker buscando certificado pela
// nuvem (nfse-certificate-fetch), o token precisa do mesmo tratamento:
// cifrado com FISCAL_CERT_ENCRYPTION_KEY (ver _shared/fiscalCrypto.ts) numa
// tabela sem NENHUMA policy (fa_kiosk_fiscal_unit_secrets, migration
// 20260902000001), escrita só por esta function e lida só por
// nfse-certificate-fetch com o segredo do worker.
//
// Mesmo desenho de nfse-certificate-upload: requireCapability antes de
// qualquer coisa, service role só depois do guard, trilha em
// fa_kiosk_audit_log na mesma chamada.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";
import { encryptSecret, hasFiscalEncryptionKey } from "../_shared/fiscalCrypto.ts";

interface CscBody {
  unitId: string;
  cscId: string;
  cscToken: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.fiscal.write");
  if (!auth.ok) return auth.response;

  let body: CscBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  const unitId = typeof body.unitId === "string" ? body.unitId.trim() : "";
  const cscId = typeof body.cscId === "string" ? body.cscId.trim() : "";
  const cscToken = typeof body.cscToken === "string" ? body.cscToken.trim() : "";

  if (!unitId || !cscId || !cscToken) {
    return jsonResponse(req, { error: "envie unitId, cscId e cscToken" }, 400);
  }
  // idCSC no XML é numérico de até 6 dígitos (a SEFAZ o zera à esquerda).
  if (!/^\d{1,6}$/.test(cscId)) {
    return jsonResponse(req, { error: "cscId inválido — use só dígitos (até 6), ex.: 000002" }, 400);
  }
  // Token real tem 36 caracteres; o limite folgado só barra colagem errada
  // (um XML, uma senha com espaço) antes de cifrar lixo.
  if (cscToken.length > 64 || /\s/.test(cscToken)) {
    return jsonResponse(req, { error: "cscToken inválido — sem espaços e com no máximo 64 caracteres" }, 400);
  }
  if (!hasFiscalEncryptionKey()) {
    return jsonResponse(req, { error: "cadastro de CSC não configurado neste ambiente" }, 503);
  }

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: unit, error: unitError } = await adminClient
    .from("fa_kiosk_units")
    .select("id")
    .eq("id", unitId)
    .maybeSingle();
  if (unitError || !unit) {
    return jsonResponse(req, { error: "unidade não encontrada" }, 404);
  }

  const { data: employee } = await adminClient
    .from("fa_kiosk_employees")
    .select("id")
    .eq("auth_user_id", auth.userId)
    .maybeSingle();

  const encryptedToken = await encryptSecret(cscToken);

  // Uma linha por unidade: trocar o CSC sobrescreve (a SEFAZ só aceita o
  // CSC vigente, não há por que guardar o anterior cifrado).
  const { error: upsertError } = await adminClient.from("fa_kiosk_fiscal_unit_secrets").upsert(
    {
      unit_id: unitId,
      nfce_csc_token_encrypted: encryptedToken,
      updated_by_employee_id: employee?.id ?? null,
      updated_at_ms: Date.now(),
    },
    { onConflict: "unit_id" },
  );
  if (upsertError) {
    return jsonResponse(req, { error: `falha ao salvar o CSC: ${upsertError.message}` }, 500);
  }

  const { error: unitUpdateError } = await adminClient
    .from("fa_kiosk_units")
    .update({ nfce_csc_id: cscId })
    .eq("id", unitId);
  if (unitUpdateError) {
    return jsonResponse(req, { error: `falha ao gravar o id do CSC na unidade: ${unitUpdateError.message}` }, 500);
  }

  // O token NUNCA entra na auditoria — só quem, quando e qual id.
  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_FISCAL_CSC_UPLOAD",
    severity: "ALERTA",
    details_json: { unitId, cscId, byAuthUserId: auth.userId },
  });

  return jsonResponse(req, { ok: true });
});
