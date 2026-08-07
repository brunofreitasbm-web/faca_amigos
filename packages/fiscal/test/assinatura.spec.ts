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
});
