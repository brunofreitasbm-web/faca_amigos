// Devolve o certificado A1 (.pfx) + senha decifrados de uma unidade, para o
// worker fiscal do kiosk (apps/kiosk/src/fiscal/nfse.ts) assinar e
// transmitir a DPS ao Sistema Nacional NFS-e.
//
// Only-service-role: o worker já guarda a service role key (mesma usada
// para tudo mais na fila fiscal, ver apps/kiosk/src/fiscal/index.ts) —
// exigir esse mesmo bearer aqui, em vez de inventar mais um secret
// compartilhado, é o suficiente para garantir que só o worker de um
// terminal legítimo chega até a chave privada. Nunca aceita a anon key
// nem uma sessão de usuário comum: isso é o inverso de requireCapability
// (nenhum humano deveria conseguir puxar a chave privada pelo navegador).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight } from "../_shared/http.ts";

interface FetchBody {
  unitId: string;
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

async function importDecryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY");
  if (!raw) throw new Error("FISCAL_CERT_ENCRYPTION_KEY não configurado");
  return crypto.subtle.importKey("raw", base64ToBytes(raw), "AES-GCM", false, ["decrypt"]);
}

// Espelha o formato gravado por nfse-certificate-upload: iv (12 bytes) + ciphertext, tudo em base64.
async function decryptPassword(encrypted: string): Promise<string> {
  const key = await importDecryptionKey();
  const combined = base64ToBytes(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse(req, { error: "não autorizado" }, 401);
  }

  let body: FetchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "corpo inválido" }, 400);
  }
  if (!body.unitId) return jsonResponse(req, { error: "envie unitId" }, 400);
  if (!Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY")) {
    return jsonResponse(req, { error: "certificado fiscal não configurado neste ambiente" }, 503);
  }

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

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
  const password = await decryptPassword(cert.encrypted_password);

  return jsonResponse(req, { pfxBase64: bytesToBase64(pfxBytes), password });
});
