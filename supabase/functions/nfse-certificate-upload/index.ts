// Upload do certificado A1 (.pfx) usado para transmitir NFS-e à prefeitura.
//
// O padrão fiscal já estabelecido (ver migration 20260806000032) é "nada
// de certificado no Supabase" — mas o usuário pediu explicitamente um
// campo de upload no Gerencial em vez do app do kiosk. Para não deixar a
// chave privada exposta na nuvem, esta function é o ÚNICO ponto de
// escrita: a senha nunca é gravada em texto puro (AES-GCM com uma chave
// que só existe aqui, em FISCAL_CERT_ENCRYPTION_KEY), o .pfx vai para um
// bucket privado sem nenhuma policy de leitura pro client (só service_role
// passa por cima do RLS), e a autorização é restrita a quem edita dados
// fiscais (config.fiscal.write, hoje só o Owner).
//
// Decifrar a senha (pra transmissão real de verdade) é trabalho de uma
// function separada, futura, chamada só pelo worker do kiosk — não existe
// ainda porque a transmissão real também não existe (layout da prefeitura
// de Belém pendente de confirmação).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";

interface UploadBody {
  unitId: string;
  pfxBase64: string;
  password: string;
  fileName?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY");
  if (!raw) throw new Error("FISCAL_CERT_ENCRYPTION_KEY não configurado");
  const keyBytes = base64ToBytes(raw);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
}

// Concatena iv (12 bytes) + ciphertext, tudo em base64 — formato que
// nfse-certificate-fetch (futura) vai precisar entender pra decifrar.
async function encryptPassword(password: string): Promise<string> {
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(password));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const auth = await requireCapability(req, "config.fiscal.write");
  if (!auth.ok) return auth.response;

  let body: UploadBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }

  if (!body.unitId || !body.pfxBase64 || !body.password) {
    return jsonResponse(req, { error: "envie unitId, o arquivo .pfx e a senha" }, 400);
  }
  if (!Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY")) {
    return jsonResponse(req, { error: "upload de certificado não configurado neste ambiente" }, 503);
  }

  let pfxBytes: Uint8Array;
  try {
    pfxBytes = base64ToBytes(body.pfxBase64);
  } catch {
    return jsonResponse(req, { error: "arquivo .pfx inválido (não é base64 válido)" }, 400);
  }
  // 12MB é folga generosa — um .pfx de empresa não passa de algumas dezenas
  // de KB; isso só existe pra recusar um upload errado antes de gravar.
  if (pfxBytes.byteLength > 12 * 1024 * 1024) {
    return jsonResponse(req, { error: "arquivo muito grande para ser um certificado A1" }, 400);
  }

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: unit, error: unitError } = await adminClient
    .from("fa_kiosk_units")
    .select("id")
    .eq("id", body.unitId)
    .maybeSingle();
  if (unitError || !unit) {
    return jsonResponse(req, { error: "unidade não encontrada" }, 404);
  }

  const storagePath = `${body.unitId}/${crypto.randomUUID()}.pfx`;
  const { error: uploadError } = await adminClient.storage
    .from("fiscal-certificados")
    .upload(storagePath, pfxBytes, { contentType: "application/x-pkcs12", upsert: false });
  if (uploadError) {
    return jsonResponse(req, { error: `falha ao gravar o certificado: ${uploadError.message}` }, 500);
  }

  const encryptedPassword = await encryptPassword(body.password);

  const { data: employee } = await adminClient
    .from("fa_kiosk_employees")
    .select("id")
    .eq("auth_user_id", auth.userId)
    .maybeSingle();

  // Um só certificado ativo por unidade: o anterior (se existir) é marcado
  // como substituído em vez de apagado — histórico de auditoria, não lixo.
  await adminClient
    .from("fa_kiosk_fiscal_certificates")
    .update({ replaced_at_ms: Date.now() })
    .eq("unit_id", body.unitId)
    .is("replaced_at_ms", null);

  const { error: insertError } = await adminClient.from("fa_kiosk_fiscal_certificates").insert({
    unit_id: body.unitId,
    storage_path: storagePath,
    encrypted_password: encryptedPassword,
    uploaded_by_employee_id: employee?.id ?? null,
  });
  if (insertError) {
    await adminClient.storage.from("fiscal-certificados").remove([storagePath]);
    return jsonResponse(req, { error: `falha ao salvar o certificado: ${insertError.message}` }, 500);
  }

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_FISCAL_CERTIFICATE_UPLOAD",
    severity: "ALERTA",
    details_json: { unitId: body.unitId, byAuthUserId: auth.userId, fileName: body.fileName ?? null },
  });

  return jsonResponse(req, { ok: true });
});
