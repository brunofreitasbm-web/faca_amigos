// Cifra/decifra os segredos fiscais que ficam no Supabase — senha do .pfx
// (fa_kiosk_fiscal_certificates.encrypted_password) e token do CSC
// (fa_kiosk_fiscal_unit_secrets.nfce_csc_token_encrypted).
//
// Uma implementação só, compartilhada por nfse-certificate-upload,
// fiscal-csc-upload (escrevem) e nfse-certificate-fetch (lê): o formato
// gravado é iv (12 bytes) + ciphertext AES-GCM, tudo num base64 só. A chave
// vive exclusivamente em FISCAL_CERT_ENCRYPTION_KEY (secret da function,
// base64 de 32 bytes) — nem o banco nem o client nunca a enxergam, então um
// dump da tabela não entrega senha nem token.

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function hasFiscalEncryptionKey(): boolean {
  return Boolean(Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY"));
}

async function importFiscalKey(usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = Deno.env.get("FISCAL_CERT_ENCRYPTION_KEY");
  if (!raw) throw new Error("FISCAL_CERT_ENCRYPTION_KEY não configurado");
  return crypto.subtle.importKey("raw", base64ToBytes(raw), "AES-GCM", false, usages);
}

// Concatena iv (12 bytes) + ciphertext, tudo em base64.
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importFiscalKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

// Inverso exato de encryptSecret.
export async function decryptSecret(encrypted: string): Promise<string> {
  const key = await importFiscalKey(["decrypt"]);
  const combined = base64ToBytes(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
