import selfsigned from "selfsigned";
import { describe, expect, it } from "vitest";
import { assinarXmlNfce, verificarAssinaturaXmlNfce } from "../src/assinatura.js";
import { montarXmlNfce } from "../src/nfce-xml.js";
import type { DocumentoFiscalInput } from "../src/types.js";

// Certificado autoassinado de teste — nunca um certificado A1 real. É o
// mesmo padrão que apps/kiosk/src/server/tls.ts já usa (pacote `selfsigned`)
// para não depender de credenciais externas nos testes.
const cert = selfsigned.generate([{ name: "commonName", value: "FACAAMIGOS LTDA:12345678000199" }], {
  days: 3650,
  keySize: 2048,
});

const input: DocumentoFiscalInput = {
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numero: 144,
  codigoNumerico: "10034444",
  tipoEmissao: 1,
  dataHoraEmissao: "2026-08-07T14:30:00-03:00",
  contingencia: null,
  emitente: {
    cnpj: "12345678000199",
    razaoSocial: "FACAAMIGOS LTDA",
    nomeFantasia: null,
    inscricaoEstadual: "123456789",
    crt: 1,
    endLogradouro: "Rod. Augusto Montenegro",
    endNumero: "s/n",
    endComplemento: null,
    endBairro: "Parque Verde",
    endMunicipioIbge: "1501402",
    endMunicipioNome: "BELEM",
    endUf: "PA",
    endCep: "66635110",
    fone: null,
  },
  destinatario: null,
  itens: [
    {
      descricao: "Água mineral 500ml",
      quantidade: 1,
      valorUnitario: 5,
      valorTotal: 5,
      ncm: "22011000",
      cest: null,
      cfop: "5102",
      csosn: "102",
      origem: 0,
      unidadeComercial: "UN",
      gtin: "SEM GTIN",
      pisCst: "49",
      cofinsCst: "49",
    },
  ],
  pagamentos: [{ metodo: "DINHEIRO", valor: 5 }],
};

describe("assinarXmlNfce / verificarAssinaturaXmlNfce", () => {
  it("assina o XML e a assinatura verifica com o certificado correto", () => {
    const { xml, chaveAcesso } = montarXmlNfce(input);
    const signed = assinarXmlNfce({
      xml,
      chaveAcesso,
      privateKeyPem: cert.private,
      certPem: cert.cert,
    });

    expect(signed).toContain("<Signature");
    expect(signed).toContain("infNFe");
    expect(verificarAssinaturaXmlNfce(signed, cert.cert)).toBe(true);
  });

  it("detecta adulteração do XML depois de assinado", () => {
    const { xml, chaveAcesso } = montarXmlNfce(input);
    const signed = assinarXmlNfce({
      xml,
      chaveAcesso,
      privateKeyPem: cert.private,
      certPem: cert.cert,
    });

    const tampered = signed.replace("<vNF>5.00</vNF>", "<vNF>999.00</vNF>");
    expect(verificarAssinaturaXmlNfce(tampered, cert.cert)).toBe(false);
  });

  it("rejeita chave de acesso que não tem 44 dígitos", () => {
    const { xml } = montarXmlNfce(input);
    expect(() =>
      assinarXmlNfce({ xml, chaveAcesso: "123", privateKeyPem: cert.private, certPem: cert.cert }),
    ).toThrow();
  });

  it("com infNFeSupl (QR Code), assina com a ordem infNFe -> infNFeSupl -> Signature, e a Reference cobre só infNFe", () => {
    const { xml, chaveAcesso } = montarXmlNfce({
      ...input,
      qrCode: {
        idCsc: "000001",
        cscToken: "segredo-csc",
        urlConsulta: "https://www.sefa.pa.gov.br/nfce/qrcode",
        urlChave: "https://www.sefa.pa.gov.br/nfce/consulta",
      },
    });
    expect(xml).toContain("<infNFeSupl>");

    const signed = assinarXmlNfce({
      xml,
      chaveAcesso,
      privateKeyPem: cert.private,
      certPem: cert.cert,
    });

    const idxInfNFeClose = signed.indexOf("</infNFe>");
    const idxInfNFeSupl = signed.indexOf("<infNFeSupl>");
    const idxSignature = signed.indexOf("<Signature");
    expect(idxInfNFeClose).toBeGreaterThan(-1);
    expect(idxInfNFeSupl).toBeGreaterThan(idxInfNFeClose);
    expect(idxSignature).toBeGreaterThan(idxInfNFeSupl);

    expect(verificarAssinaturaXmlNfce(signed, cert.cert)).toBe(true);

    // infNFeSupl fica FORA do digest assinado — mutar só o urlChave não
    // pode invalidar a assinatura.
    const tamperedSupl = signed.replace(
      "https://www.sefa.pa.gov.br/nfce/consulta",
      "https://exemplo-adulterado.invalido/consulta",
    );
    expect(verificarAssinaturaXmlNfce(tamperedSupl, cert.cert)).toBe(true);

    // Mutar algo DENTRO de infNFe já invalida a assinatura (mesmo teste de
    // adulteração já coberto acima para o caso sem infNFeSupl — aqui só
    // confirmamos que continua valendo quando infNFeSupl está presente).
    const tamperedInfNFe = signed.replace("<vNF>5.00</vNF>", "<vNF>999.00</vNF>");
    expect(verificarAssinaturaXmlNfce(tamperedInfNFe, cert.cert)).toBe(false);
  });
});

/**
 * Regressão do cStat 225 ("Falha no Schema XML da NFe — Atributo:
 * Algorithm").
 *
 * O XSD da NF-e restringe `Algorithm` a uma lista fechada. A assinatura
 * usava canonicalização EXCLUSIVA (`exc-c14n`), que não está nessa lista,
 * e a SEFAZ recusou em homologação em 2026-09-02 com a nota já montada,
 * numerada e transmitida.
 *
 * Nenhum teste olhava para esses atributos — validavam que a assinatura
 * existia e batia, o que continua verdade com o algoritmo errado. Estes
 * comparam as URIs exatas que a SEFAZ aceita.
 */
describe("URIs de Algorithm exigidas pelo XSD da NF-e", () => {
  const C14N_INCLUSIVO = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
  const assinado = assinarXmlNfce({
    xml: montarXmlNfce(input).xml,
    chaveAcesso: montarXmlNfce(input).chaveAcesso,
    privateKeyPem: cert.private,
    certPem: cert.cert,
  });

  it("canonicaliza com C14N inclusivo, nunca com exc-c14n", () => {
    expect(assinado).toContain(`<CanonicalizationMethod Algorithm="${C14N_INCLUSIVO}"`);
    expect(assinado, "exc-c14n não está na lista fechada do XSD — é o cStat 225").not.toContain(
      "xml-exc-c14n",
    );
  });

  it("assina com rsa-sha1 e digest sha1", () => {
    expect(assinado).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
    expect(assinado).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"');
  });

  it("usa os dois Transforms do manual: enveloped-signature e C14N inclusivo", () => {
    expect(assinado).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(assinado).toContain(`<Transform Algorithm="${C14N_INCLUSIVO}"`);
  });
});
