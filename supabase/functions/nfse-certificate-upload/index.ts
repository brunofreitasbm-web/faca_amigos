// Upload do certificado A1 (.pfx) usado para transmitir NFS-e (prefeitura)
// e NFC-e (SVRS).
//
// O padrão fiscal já estabelecido (ver migration 20260806000032) é "nada
// de certificado no Supabase" — mas o usuário pediu explicitamente um
// campo de upload no Gerencial em vez do app do kiosk. Para não deixar a
// chave privada exposta na nuvem, esta function é o ÚNICO ponto de
// escrita: a senha nunca é gravada em texto puro (AES-GCM com uma chave
// que só existe nas functions, em FISCAL_CERT_ENCRYPTION_KEY — ver
// _shared/fiscalCrypto.ts), o .pfx vai para um bucket privado sem nenhuma
// policy de leitura pro client (só service_role passa por cima do RLS), e
// a autorização é restrita a quem edita dados fiscais (config.fiscal.write).
//
// Decifrar a senha é trabalho de nfse-certificate-fetch, chamada só pelo
// worker do kiosk com o segredo do worker — nunca por sessão de usuário.
//
// Antes de gravar, o .pfx é ABERTO aqui (node-forge) com a senha informada:
// senha errada, certificado vencido ou de outro CNPJ são recusados na hora,
// com mensagem clara pro Owner, em vez de virarem "BLOQUEADO" misterioso
// na fila fiscal dias depois. Titular/emissor/validade lidos do próprio
// certificado vão pra tabela pro Gerencial mostrar "válido até".

import { createClient } from "jsr:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { jsonResponse, preflight } from "../_shared/http.ts";
import { requireCapability } from "../_shared/requireCapability.ts";
import { base64ToBytes, encryptSecret, hasFiscalEncryptionKey } from "../_shared/fiscalCrypto.ts";

interface UploadBody {
  unitId: string;
  pfxBase64: string;
  password: string;
  fileName?: string;
}

interface PfxInfo {
  subjectCn: string | null;
  issuerCn: string | null;
  notAfterMs: number | null;
  /** CNPJ (14 dígitos) extraído do CN, padrão ICP-Brasil "RAZAO SOCIAL:12345678000199". */
  cnpj: string | null;
}

type PfxParseResult = { ok: true; info: PfxInfo } | { ok: false; reason: "ARQUIVO_INVALIDO" | "SENHA_INVALIDA" | "SEM_CERTIFICADO" };

function bytesToBinaryString(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return bin;
}

// node-forge não traz tipos; o mínimo estrutural que usamos abaixo.
interface ForgeName {
  hash?: string;
  getField(name: string): { value?: string } | null | undefined;
}
interface ForgeCertificate {
  subject: ForgeName;
  issuer: ForgeName;
  validity?: { notAfter?: Date };
  publicKey?: { n?: { compareTo(other: unknown): number } };
}
interface ForgeBag {
  cert?: ForgeCertificate;
  key?: { n?: unknown };
}

// Abre o PKCS#12 e localiza o certificado do titular. Um .pfx de empresa
// costuma carregar a cadeia inteira (titular + ACs intermediárias), então
// o titular é o que casa com a chave privada; sem chave, cai no primeiro
// que não é emissor de nenhum outro.
function parsePfx(bytes: Uint8Array, password: string): PfxParseResult {
  let asn1: unknown;
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytesToBinaryString(bytes)));
  } catch {
    return { ok: false, reason: "ARQUIVO_INVALIDO" };
  }

  // deno-lint-ignore no-explicit-any
  let p12: any;
  try {
    // strict=false: tolera atributos que a ICP-Brasil costuma incluir e o
    // forge não reconhece; a senha continua sendo validada pelo MAC.
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    // node-forge sinaliza senha errada como falha de MAC ("Invalid password?")
    // ou como erro de decifragem do bag; qualquer outra coisa é arquivo ruim.
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes("password") || msg.includes("mac") || msg.includes("decrypt")) {
      return { ok: false, reason: "SENHA_INVALIDA" };
    }
    return { ok: false, reason: "ARQUIVO_INVALIDO" };
  }

  const certBagType: string = forge.pki.oids.certBag;
  const certBags: ForgeBag[] = p12.getBags({ bagType: certBagType })[certBagType] ?? [];
  const certs = certBags.map((bag) => bag.cert).filter((c): c is ForgeCertificate => Boolean(c));
  if (certs.length === 0) return { ok: false, reason: "SEM_CERTIFICADO" };

  let leaf: ForgeCertificate | undefined;
  const keyBagType: string = forge.pki.oids.pkcs8ShroudedKeyBag;
  const keyBags: ForgeBag[] = p12.getBags({ bagType: keyBagType })[keyBagType] ?? [];
  const privateKey = keyBags[0]?.key;
  if (privateKey?.n) {
    leaf = certs.find((c) => c.publicKey?.n && c.publicKey.n.compareTo(privateKey.n) === 0);
  }
  if (!leaf) {
    const issuerHashes = new Set(certs.map((c) => c.issuer.hash).filter(Boolean));
    leaf = certs.find((c) => !c.subject.hash || !issuerHashes.has(c.subject.hash)) ?? certs[0]!;
  }

  const subjectCn = leaf.subject.getField("CN")?.value ?? null;
  const issuerCn = leaf.issuer.getField("CN")?.value ?? null;
  const notAfter = leaf.validity?.notAfter;
  const notAfterMs = notAfter instanceof Date && !Number.isNaN(notAfter.getTime()) ? notAfter.getTime() : null;
  const cnpj = subjectCn?.match(/:(\d{14})$/)?.[1] ?? null;

  return { ok: true, info: { subjectCn, issuerCn, notAfterMs, cnpj } };
}

function formatCnpj(digits: string): string {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatDateBr(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
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
  if (!hasFiscalEncryptionKey()) {
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

  const parsed = parsePfx(pfxBytes, body.password);
  if (!parsed.ok) {
    if (parsed.reason === "SENHA_INVALIDA") {
      return jsonResponse(req, { error: "senha do certificado inválida — confira e tente de novo" }, 400);
    }
    if (parsed.reason === "SEM_CERTIFICADO") {
      return jsonResponse(req, { error: "o arquivo .pfx não contém nenhum certificado" }, 400);
    }
    return jsonResponse(req, { error: "arquivo .pfx inválido (não é um PKCS#12 legível)" }, 400);
  }
  const certInfo = parsed.info;

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: unit, error: unitError } = await adminClient
    .from("fa_kiosk_units")
    .select("id, cnpj")
    .eq("id", body.unitId)
    .maybeSingle();
  if (unitError || !unit) {
    return jsonResponse(req, { error: "unidade não encontrada" }, 404);
  }

  // Compara só a RAIZ (8 primeiros dígitos): certificado de filial e de
  // matriz compartilham a raiz, e o cadastro da unidade pode estar com
  // qualquer um dos dois.
  const unitCnpj = String(unit.cnpj ?? "").replace(/\D/g, "");
  if (certInfo.cnpj && unitCnpj.length === 14 && certInfo.cnpj.slice(0, 8) !== unitCnpj.slice(0, 8)) {
    return jsonResponse(req, {
      error: `o certificado é de outro CNPJ (${formatCnpj(certInfo.cnpj)}) — a unidade está cadastrada como ${formatCnpj(unitCnpj)}`,
    }, 400);
  }

  if (certInfo.notAfterMs !== null && certInfo.notAfterMs <= Date.now()) {
    return jsonResponse(req, {
      error: `certificado vencido em ${formatDateBr(certInfo.notAfterMs)} — peça um novo A1 à certificadora`,
    }, 400);
  }

  const storagePath = `${body.unitId}/${crypto.randomUUID()}.pfx`;
  const { error: uploadError } = await adminClient.storage
    .from("fiscal-certificados")
    .upload(storagePath, pfxBytes, { contentType: "application/x-pkcs12", upsert: false });
  if (uploadError) {
    return jsonResponse(req, { error: `falha ao gravar o certificado: ${uploadError.message}` }, 500);
  }

  const encryptedPassword = await encryptSecret(body.password);

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
    subject_cn: certInfo.subjectCn,
    issuer_cn: certInfo.issuerCn,
    expires_at_ms: certInfo.notAfterMs,
    uploaded_by_employee_id: employee?.id ?? null,
  });
  if (insertError) {
    await adminClient.storage.from("fiscal-certificados").remove([storagePath]);
    return jsonResponse(req, { error: `falha ao salvar o certificado: ${insertError.message}` }, 500);
  }

  await adminClient.from("fa_kiosk_audit_log").insert({
    action: "CONFIG_FISCAL_CERTIFICATE_UPLOAD",
    severity: "ALERTA",
    details_json: {
      unitId: body.unitId,
      byAuthUserId: auth.userId,
      fileName: body.fileName ?? null,
      subjectCn: certInfo.subjectCn,
      expiresAtMs: certInfo.notAfterMs,
    },
  });

  return jsonResponse(req, { ok: true });
});
