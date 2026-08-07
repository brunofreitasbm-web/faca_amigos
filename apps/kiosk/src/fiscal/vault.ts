import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

/**
 * Cofre do certificado fiscal (Fase 2 do plano) — vive só no PC do balcão,
 * em `app.getPath('userData')/fiscal/`. Nunca no Supabase, nunca no
 * repositório, nunca em `localStorage`.
 *
 * Este módulo é Node puro e testável sem Electron de verdade: a cifra da
 * senha/CSC é injetada via `CofreCrypto` — em produção isso é
 * `safeStorage` do Electron (ver electron-crypto.ts, o único arquivo desta
 * pasta que importa `electron`), atrelado à conta do Windows via DPAPI.
 * Copiar a pasta para outro PC não funciona — é proposital: reinstala-se o
 * certificado com a senha digitada de novo.
 */

export interface CofreCrypto {
  encrypt(plainText: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

export interface CertificadoMeta {
  subjectCn: string;
  /** null quando o CN não segue o padrão "RAZÃO SOCIAL:CNPJ" do e-CNPJ ICP-Brasil. */
  cnpj: string | null;
  notAfterMs: number;
}

export interface CofreCredenciais {
  pfxBuffer: Buffer;
  password: string;
  cscToken: string | null;
}

function vaultDir(userDataPath: string): string {
  return join(userDataPath, "fiscal");
}
function pfxPath(userDataPath: string): string {
  return join(vaultDir(userDataPath), "cert.pfx");
}
function passPath(userDataPath: string): string {
  return join(vaultDir(userDataPath), "cert.pass.enc");
}
function cscPath(userDataPath: string): string {
  return join(vaultDir(userDataPath), "csc.enc");
}

function ensureVaultDir(userDataPath: string): string {
  const dir = vaultDir(userDataPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// `forge.pki.oids` só tem assinatura de índice (`[key: string]: string`), e
// com `noUncheckedIndexedAccess` isso tipa qualquer acesso como
// `string | undefined` mesmo por notação de ponto. Os dois nomes abaixo são
// constantes conhecidas do PKCS#12 (conferidas em runtime antes de escrever
// este módulo) — não-nulas por construção, não por opção do certificado.
const OID_CERT_BAG = forge.pki.oids.certBag!;
const OID_PKCS8_SHROUDED_KEY_BAG = forge.pki.oids.pkcs8ShroudedKeyBag!;

/** true se já existe um certificado instalado neste PC. */
export function hasCertificateInstalled(userDataPath: string): boolean {
  return existsSync(pfxPath(userDataPath));
}

/** true se um token de CSC já foi gravado no cofre. Usado só pelo heartbeat — nunca expõe o valor. */
export function hasCscConfigured(userDataPath: string): boolean {
  return existsSync(cscPath(userDataPath));
}

/**
 * Abre o `.pfx` (PKCS#12) só para ler metadados — CN, CNPJ e validade —
 * sem extrair a chave privada. Usado tanto para validar a senha na
 * instalação quanto para o heartbeat periódico.
 */
export function parseCertificadoMeta(pfxBuffer: Buffer, password: string): CertificadoMeta {
  const der = forge.util.createBuffer(pfxBuffer.toString("binary"));
  const asn1 = forge.asn1.fromDer(der);

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new Error("Não foi possível abrir o certificado — confira a senha digitada.");
  }

  const certBag = p12.getBags({ bagType: OID_CERT_BAG })[OID_CERT_BAG]?.[0];
  if (!certBag?.cert) {
    throw new Error("O arquivo não contém um certificado válido dentro do .pfx.");
  }

  const cnField = certBag.cert.subject.getField("CN");
  const subjectCn = typeof cnField?.value === "string" ? cnField.value : "";
  // ICP-Brasil e-CNPJ codifica o CN como "RAZÃO SOCIAL:14DIGITOSDOCNPJ".
  const cnpjMatch = /:(\d{14})$/.exec(subjectCn);

  return {
    subjectCn,
    cnpj: cnpjMatch ? cnpjMatch[1]! : null,
    notAfterMs: certBag.cert.validity.notAfter.getTime(),
  };
}

/** Extrai a chave privada e o certificado em PEM — só para uso do worker ao assinar. */
export function extrairChaveECertificadoPem(
  pfxBuffer: Buffer,
  password: string,
): { certPem: string; privateKeyPem: string } {
  const der = forge.util.createBuffer(pfxBuffer.toString("binary"));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const certBag = p12.getBags({ bagType: OID_CERT_BAG })[OID_CERT_BAG]?.[0];
  const keyBag = p12.getBags({ bagType: OID_PKCS8_SHROUDED_KEY_BAG })[OID_PKCS8_SHROUDED_KEY_BAG]?.[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new Error("Não foi possível extrair certificado e chave privada do .pfx.");
  }

  return {
    certPem: forge.pki.certificateToPem(certBag.cert),
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
  };
}

/**
 * Copia o `.pfx` para o cofre e cifra senha + CSC. Valida a senha ABRINDO o
 * certificado antes de gravar qualquer coisa — nunca guardamos um par
 * arquivo/senha que não abre.
 */
export function installCertificate(params: {
  userDataPath: string;
  pfxBuffer: Buffer;
  password: string;
  cscToken: string | null;
  crypto: CofreCrypto;
}): CertificadoMeta {
  const meta = parseCertificadoMeta(params.pfxBuffer, params.password);

  ensureVaultDir(params.userDataPath);
  writeFileSync(pfxPath(params.userDataPath), params.pfxBuffer);
  writeFileSync(passPath(params.userDataPath), params.crypto.encrypt(params.password));
  if (params.cscToken) {
    writeFileSync(cscPath(params.userDataPath), params.crypto.encrypt(params.cscToken));
  }

  return meta;
}

/** Lê o `.pfx` + senha + CSC decifrados do cofre. null se nada foi instalado ainda. */
export function readCredentials(params: { userDataPath: string; crypto: CofreCrypto }): CofreCredenciais | null {
  const pfxFile = pfxPath(params.userDataPath);
  const passFile = passPath(params.userDataPath);
  if (!existsSync(pfxFile) || !existsSync(passFile)) return null;

  const pfxBuffer = readFileSync(pfxFile);
  const password = params.crypto.decrypt(readFileSync(passFile));
  const cscFile = cscPath(params.userDataPath);
  const cscToken = existsSync(cscFile) ? params.crypto.decrypt(readFileSync(cscFile)) : null;

  return { pfxBuffer, password, cscToken };
}

/** Atalho para o heartbeat: metadados do certificado já instalado, sem expor a chave privada. */
export function readCertificadoMetaFromVault(params: {
  userDataPath: string;
  crypto: CofreCrypto;
}): CertificadoMeta | null {
  const creds = readCredentials(params);
  if (!creds) return null;
  return parseCertificadoMeta(creds.pfxBuffer, creds.password);
}
