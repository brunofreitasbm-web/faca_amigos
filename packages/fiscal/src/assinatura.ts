import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

/**
 * Assinatura XMLDSig da NFC-e — o ponto onde a maioria das implementações
 * caseiras empaca (ver Fase 4 do plano). Recebe a chave privada e o
 * certificado já extraídos em PEM; a extração do `.pfx` (PKCS#12) é
 * responsabilidade do cofre local no Electron (apps/kiosk/src/fiscal/vault.ts,
 * Fase 2) — este pacote nunca toca em disco nem no arquivo `.pfx` original.
 *
 * Parâmetros exigidos pelo layout NF-e/NFC-e:
 *   - Canonicalização exclusiva (`exc-c14n`)
 *   - Algoritmo de assinatura `rsa-sha1`, digest `sha1`
 *   - Transform `enveloped-signature` + `exc-c14n`
 *   - `Reference URI="#NFe<chaveDeAcesso>"`, apontando para o `Id` do `infNFe`
 *   - `KeyInfo` com `X509Data` (o certificado do emitente, para a SEFAZ
 *     conseguir validar a cadeia)
 */

const ALGORITMO_ASSINATURA = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const ALGORITMO_CANONICALIZACAO = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ALGORITMO_DIGEST = "http://www.w3.org/2000/09/xmldsig#sha1";
const TRANSFORM_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export interface AssinarXmlNfceInput {
  /** XML da NFC-e ainda sem assinatura, contendo `<infNFe Id="NFe<chave>">`. */
  xml: string;
  /** Chave de acesso de 44 dígitos — usada para montar a URI da referência. */
  chaveAcesso: string;
  /** Chave privada em PEM, já decifrada do `.pfx`. */
  privateKeyPem: string;
  /** Certificado do emitente em PEM (a folha da cadeia, não a raiz). */
  certPem: string;
}

export function assinarXmlNfce(input: AssinarXmlNfceInput): string {
  const chave = input.chaveAcesso.replace(/\D/g, "");
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso precisa ter 44 dígitos para assinar, recebeu ${chave.length}`);
  }

  const sig = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certPem,
    signatureAlgorithm: ALGORITMO_ASSINATURA,
    canonicalizationAlgorithm: ALGORITMO_CANONICALIZACAO,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    uri: `NFe${chave}`,
    transforms: [TRANSFORM_ENVELOPED, ALGORITMO_CANONICALIZACAO],
    digestAlgorithm: ALGORITMO_DIGEST,
  });

  // A assinatura entra como o ÚLTIMO filho do elemento raiz <NFe> — isso
  // funciona tanto com quanto sem o grupo opcional <infNFeSupl> (QR Code,
  // ver nfce-xml.ts): a sequência exigida pelo layout 4.00 é
  // infNFe -> infNFeSupl (opcional) -> Signature. A Reference, de propósito,
  // continua cobrindo só o <infNFe> (xpath acima) — o <infNFeSupl> fica
  // fora do digest assinado, como o XSD/manual da NFC-e determina.
  sig.computeSignature(input.xml, {
    location: { reference: "//*[local-name(.)='NFe']", action: "append" },
  });

  return sig.getSignedXml();
}

const ALGORITMO_CANONICALIZACAO_DPS = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

export interface AssinarXmlDpsInput {
  /** XML da DPS ainda sem assinatura, contendo `<infDPS Id="DPS...">`. */
  xml: string;
  /** Id de 45 posições do infDPS (ver montarIdDps em dps-nacional-xml.ts) — vira `URI="#<idDps>"`. */
  idDps: string;
  /** Chave privada em PEM, já decifrada do `.pfx`. */
  privateKeyPem: string;
  /** Certificado do emitente em PEM (a folha da cadeia, não a raiz). */
  certPem: string;
}

/**
 * Assinatura XMLDSig da DPS (Modelo Nacional de NFS-e) — mesma dupla
 * RSA-SHA1/SHA1 da NFC-e, mas com canonicalização C14N "pura" (não
 * exclusiva), conforme o Manual de Contribuintes da Prefeitura de Belém
 * (seção "Padrão de assinatura", 2026-08-19): a NFC-e usa `exc-c14n`, a
 * DPS nacional usa `REC-xml-c14n-20010315` — as duas exigências não são
 * intercambiáveis, daí a função separada em vez de reaproveitar
 * `assinarXmlNfce` com um parâmetro a mais.
 */
export function assinarXmlDps(input: AssinarXmlDpsInput): string {
  const sig = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certPem,
    signatureAlgorithm: ALGORITMO_ASSINATURA,
    canonicalizationAlgorithm: ALGORITMO_CANONICALIZACAO_DPS,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    uri: input.idDps,
    transforms: [TRANSFORM_ENVELOPED, ALGORITMO_CANONICALIZACAO_DPS],
    digestAlgorithm: ALGORITMO_DIGEST,
  });

  // Assinatura envelopada, irmã de infDPS, dentro da tag raiz <DPS> — igual
  // ao manual, seção "Regras Estruturais da Assinatura".
  sig.computeSignature(input.xml, {
    location: { reference: "//*[local-name(.)='infDPS']", action: "after" },
  });

  return sig.getSignedXml();
}

/**
 * Verifica uma assinatura já aplicada, usando o certificado público
 * informado. Usado nos testes (com um certificado autoassinado de teste) e,
 * no worker, como conferência antes de transmitir — nunca custa validar a
 * própria assinatura antes de gastar uma chamada à SEFAZ.
 */
export function verificarAssinaturaXmlNfce(xmlAssinado: string, certPem: string): boolean {
  // A API do xml-crypto exige que o nó <Signature> seja extraído e carregado
  // explicitamente antes de checkSignature() — passar só o XML completo não
  // basta (README do pacote, seção "Verifying").
  const doc = new DOMParser().parseFromString(xmlAssinado, "text/xml");
  const signatureNode = doc.getElementsByTagNameNS(
    "http://www.w3.org/2000/09/xmldsig#",
    "Signature",
  )[0];
  if (!signatureNode) return false;

  const sig = new SignedXml({
    publicCert: certPem,
    getCertFromKeyInfo: () => certPem,
  });
  sig.loadSignature(signatureNode as unknown as Node);
  return sig.checkSignature(xmlAssinado);
}
