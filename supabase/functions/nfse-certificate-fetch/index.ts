// Devolve o certificado A1 (.pfx) + senha decifrados de uma unidade, e o CSC
// (id + token) da NFC-e, para o worker fiscal do kiosk (apps/kiosk/src/fiscal)
// assinar e transmitir DPS (NFS-e) e NFC-e.
//
// Só o worker chama isto — nunca um humano pelo navegador. A autorização é
// por segredo exato: o bearer tem que ser IGUAL à service role key legada
// (SUPABASE_SERVICE_ROLE_KEY, JWT) ou à chave nova do worker
// (FISCAL_WORKER_SECRET_KEY, formato `sb_secret_...`). Comparação em tempo
// constante, sem `includes()`, sem fallback pra sessão de usuário: a chave
// privada do certificado não pode ser puxada por ninguém com
// config.fiscal.write, que hoje é qualquer Operador (migration 20260830000004).
//
// A chave `sb_secret_` NÃO é JWT, então o portão do Supabase recusaria a
// chamada antes dela chegar aqui — por isso `verify_jwt = false` em
// supabase/config.toml. A checagem de verdade é a deste arquivo.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { bytesToBase64, decryptSecret, hasFiscalEncryptionKey } from "../_shared/fiscalCrypto.ts";

interface FetchBody {
  unitId: string;
}

// Mesmo comprimento + XOR de todos os bytes: o tempo de resposta não conta
// quantos caracteres do segredo o chamador acertou.
function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const allowed = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("FISCAL_WORKER_SECRET_KEY")].filter(
    (s): s is string => Boolean(s),
  );
  return allowed.some((secret) => constantTimeEqual(bearer, secret));
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  if (!isAuthorized(req)) {
    return jsonResponse(req, { error: "não autorizado" }, 401);
  }

  let body: FetchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!body.unitId) return jsonResponse(req, { error: "envie unitId" }, 400);
  if (!hasFiscalEncryptionKey()) {
    return jsonResponse(req, { error: "certificado fiscal não configurado neste ambiente" }, 503);
  }

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cert, error } = await adminClient
    .from("fa_kiosk_fiscal_certificates")
    .select("storage_path, encrypted_password")
    .eq("unit_id", body.unitId)
    .is("replaced_at_ms", null)
    .maybeSingle();
  if (error || !cert) {
    return jsonResponse(req, { error: "nenhum certificado configurado para esta unidade" }, 404);
  }

  const { data: pfxFile, error: downloadError } = await adminClient.storage.from("fiscal-certificados").download(cert.storage_path);
  if (downloadError || !pfxFile) {
    return jsonResponse(req, { error: "falha ao ler o certificado do armazenamento" }, 500);
  }

  const pfxBytes = new Uint8Array(await pfxFile.arrayBuffer());
  const password = await decryptSecret(cert.encrypted_password);

  // CSC da NFC-e: o id mora em fa_kiosk_units (não é segredo), o token só
  // cifrado em fa_kiosk_fiscal_unit_secrets (gravado por fiscal-csc-upload).
  // Ausência não é erro — NFS-e não usa CSC; quem decide se bloqueia é o
  // worker, na hora de montar o QR Code.
  const [{ data: unit }, { data: secrets }] = await Promise.all([
    adminClient.from("fa_kiosk_units").select("nfce_csc_id").eq("id", body.unitId).maybeSingle(),
    adminClient.from("fa_kiosk_fiscal_unit_secrets").select("nfce_csc_token_encrypted").eq("unit_id", body.unitId).maybeSingle(),
  ]);
  const cscId: string | null = unit?.nfce_csc_id ?? null;
  const cscToken: string | null = secrets?.nfce_csc_token_encrypted
    ? await decryptSecret(secrets.nfce_csc_token_encrypted)
    : null;

  return jsonResponse(req, { pfxBase64: bytesToBase64(pfxBytes), password, cscId, cscToken });
});
