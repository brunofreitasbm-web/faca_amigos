import { create } from "xmlbuilder2";
import { SignedXml } from "xml-crypto";
import { tpAmbFromAmbiente, type FiscalAmbiente } from "./types.js";

const XMLNS_NFE = "http://www.portalfiscal.inf.br/nfe";
const ALGORITMO_ASSINATURA = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const ALGORITMO_CANONICALIZACAO = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ALGORITMO_DIGEST = "http://www.w3.org/2000/09/xmldsig#sha1";
const TRANSFORM_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export interface MontarXmlCancelamentoInput {
  chaveAcesso: string;
  cnpj: string;
  protocolo: string;
  justificativa: string;
  ambiente: FiscalAmbiente;
  dataHoraEvento?: string;
  seqEvento?: number;
}

export interface MontarXmlCancelamentoResult {
  xml: string;
  idEvento: string;
}

export function montarXmlCancelamento(input: MontarXmlCancelamentoInput): MontarXmlCancelamentoResult {
  const chave = input.chaveAcesso.replace(/\D/g, "");
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso inválida para cancelamento (esperado 44 dígitos): ${input.chaveAcesso}`);
  }
  if (input.justificativa.length < 15) {
    throw new Error("A justificativa de cancelamento deve ter no mínimo 15 caracteres (exigência da SEFAZ).");
  }

  const seq = input.seqEvento ?? 1;
  const seqPad = String(seq).padStart(2, "0");
  const idEvento = `ID110111${chave}${seqPad}`;
  const tpAmb = tpAmbFromAmbiente(input.ambiente);
  const dhEvento = input.dataHoraEvento ?? new Date().toISOString();

  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("evento", {
    xmlns: XMLNS_NFE,
    versao: "1.00",
  });

  doc.ele("infEvento", { Id: idEvento })
    .ele("cOrgao").txt("15").up() // 15 = Pará
    .ele("tpAmb").txt(tpAmb).up()
    .ele("CNPJ").txt(input.cnpj.replace(/\D/g, "")).up()
    .ele("chNFe").txt(chave).up()
    .ele("dhEvento").txt(dhEvento).up()
    .ele("tpEvento").txt("110111").up() // 110111 = Cancelamento da NFC-e
    .ele("nSeqEvento").txt(String(seq)).up()
    .ele("verEvento").txt("1.00").up()
    .ele("detEvento", { versao: "1.00" })
      .ele("descEvento").txt("Cancelamento").up()
      .ele("nProt").txt(input.protocolo.replace(/\D/g, "")).up()
      .ele("xJust").txt(input.justificativa.slice(0, 255)).up()
    .up();

  return {
    xml: doc.end({ prettyPrint: false }),
    idEvento,
  };
}

export interface AssinarXmlEventoInput {
  xml: string;
  idEvento: string;
  privateKeyPem: string;
  certPem: string;
}

export function assinarXmlEvento(input: AssinarXmlEventoInput): string {
  const sig = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certPem,
    signatureAlgorithm: ALGORITMO_ASSINATURA,
    canonicalizationAlgorithm: ALGORITMO_CANONICALIZACAO,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    uri: input.idEvento,
    transforms: [TRANSFORM_ENVELOPED, ALGORITMO_CANONICALIZACAO],
    digestAlgorithm: ALGORITMO_DIGEST,
  });

  sig.computeSignature(input.xml, {
    location: { reference: "//*[local-name(.)='infEvento']", action: "after" },
  });

  return sig.getSignedXml();
}

export interface MontarXmlInutilizacaoInput {
  cnpj: string;
  ano: number; // Ex: 26 para 2026
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  ambiente: FiscalAmbiente;
}

export interface MontarXmlInutilizacaoResult {
  xml: string;
  idInut: string;
}

export function montarXmlInutilizacao(input: MontarXmlInutilizacaoInput): MontarXmlInutilizacaoResult {
  const cnpjClean = input.cnpj.replace(/\D/g, "");
  const anoStr = String(input.ano).slice(-2).padStart(2, "0");
  const serieStr = String(input.serie).padStart(3, "0");
  const numIniStr = String(input.numeroInicial).padStart(9, "0");
  const numFinStr = String(input.numeroFinal).padStart(9, "0");

  const idInut = `ID15${cnpjClean}65${serieStr}${numIniStr}${numFinStr}`;
  const tpAmb = tpAmbFromAmbiente(input.ambiente);

  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("inutNFe", {
    xmlns: XMLNS_NFE,
    versao: "4.00",
  });

  doc.ele("infInut", { Id: idInut })
    .ele("tpAmb").txt(tpAmb).up()
    .ele("xServ").txt("INUTILIZAR").up()
    .ele("cUF").txt("15").up()
    .ele("ano").txt(anoStr).up()
    .ele("CNPJ").txt(cnpjClean).up()
    .ele("mod").txt("65").up()
    .ele("serie").txt(String(input.serie)).up()
    .ele("nNFIni").txt(String(input.numeroInicial)).up()
    .ele("nNFFin").txt(String(input.numeroFinal)).up()
    .ele("xJust").txt(input.justificativa.slice(0, 255)).up()
    .up();

  return {
    xml: doc.end({ prettyPrint: false }),
    idInut,
  };
}

export interface AssinarXmlInutilizacaoInput {
  xml: string;
  idInut: string;
  privateKeyPem: string;
  certPem: string;
}

export function assinarXmlInutilizacao(input: AssinarXmlInutilizacaoInput): string {
  const sig = new SignedXml({
    privateKey: input.privateKeyPem,
    publicCert: input.certPem,
    signatureAlgorithm: ALGORITMO_ASSINATURA,
    canonicalizationAlgorithm: ALGORITMO_CANONICALIZACAO,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infInut']",
    uri: input.idInut,
    transforms: [TRANSFORM_ENVELOPED, ALGORITMO_CANONICALIZACAO],
    digestAlgorithm: ALGORITMO_DIGEST,
  });

  sig.computeSignature(input.xml, {
    location: { reference: "//*[local-name(.)='infInut']", action: "after" },
  });

  return sig.getSignedXml();
}
