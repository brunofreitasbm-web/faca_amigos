import { describe, expect, it } from "vitest";
import { montarXmlNfce } from "../src/nfce-xml.js";
import type { DocumentoFiscalInput } from "../src/types.js";

function buildInput(overrides: Partial<DocumentoFiscalInput> = {}): DocumentoFiscalInput {
  return {
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
      nomeFantasia: "FaçaAmigos",
      inscricaoEstadual: "123456789",
      crt: 1,
      endLogradouro: "Rod. Augusto Montenegro",
      endNumero: "s/n",
      endComplemento: "Parque Shopping Belém",
      endBairro: "Parque Verde",
      endMunicipioIbge: "1501402",
      endMunicipioNome: "BELEM",
      endUf: "PA",
      endCep: "66635110",
      fone: "9130000000",
    },
    destinatario: null,
    itens: [
      {
        descricao: "Água mineral 500ml",
        quantidade: 2,
        valorUnitario: 5,
        valorTotal: 10,
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
    pagamentos: [{ metodo: "PIX", valor: 10 }],
    ...overrides,
  };
}

describe("montarXmlNfce", () => {
  it("gera um XML bem formado com o Id do infNFe batendo com a chave retornada", () => {
    const { xml, chaveAcesso } = montarXmlNfce(buildInput());
    expect(chaveAcesso).toHaveLength(44);
    expect(xml).toContain(`Id="NFe${chaveAcesso}"`);
    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/nfe"');
  });

  it("usa mod=65 (NFC-e) e cUF=15 (Pará)", () => {
    const { xml } = montarXmlNfce(buildInput());
    expect(xml).toContain("<mod>65</mod>");
    expect(xml).toContain("<cUF>15</cUF>");
  });

  it("usa tpAmb=2 em homologação e tpAmb=1 em produção", () => {
    const homolog = montarXmlNfce(buildInput({ ambiente: "HOMOLOGACAO" }));
    expect(homolog.xml).toContain("<tpAmb>2</tpAmb>");

    const producao = montarXmlNfce(buildInput({ ambiente: "PRODUCAO" }));
    expect(producao.xml).toContain("<tpAmb>1</tpAmb>");
  });

  it("soma o valor dos itens em vProd e vNF", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        itens: [
          {
            descricao: "Água mineral 500ml",
            quantidade: 2,
            valorUnitario: 5,
            valorTotal: 10,
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
          {
            descricao: "Salgadinho",
            quantidade: 1,
            valorUnitario: 7.5,
            valorTotal: 7.5,
            ncm: "19059090",
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
        pagamentos: [{ metodo: "DINHEIRO", valor: 17.5 }],
      }),
    );
    expect(xml).toContain("<vProd>17.50</vProd>");
    expect(xml).toContain("<vNF>17.50</vNF>");
  });

  it("omite o grupo <dest> quando não há CPF do consumidor", () => {
    const { xml } = montarXmlNfce(buildInput({ destinatario: null }));
    expect(xml).not.toContain("<dest>");
  });

  it("inclui o CPF do consumidor quando informado", () => {
    const { xml } = montarXmlNfce(
      buildInput({ destinatario: { cpf: "12345678909", nome: "Maria Souza" } }),
    );
    expect(xml).toContain("<CPF>12345678909</CPF>");
    expect(xml).toContain("<xNome>Maria Souza</xNome>");
  });

  it("mapeia a forma de pagamento para o código tPag correspondente", () => {
    const { xml } = montarXmlNfce(buildInput({ pagamentos: [{ metodo: "PIX", valor: 10 }] }));
    expect(xml).toContain("<tPag>17</tPag>");
  });

  it("inclui dhCont e xJust quando emitida em contingência offline", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        tipoEmissao: 9,
        contingencia: {
          dataHoraEntrada: "2026-08-07T14:00:00-03:00",
          justificativa: "Sem conexão com a internet no momento da venda",
        },
      }),
    );
    expect(xml).toContain("<tpEmis>9</tpEmis>");
    expect(xml).toContain("<xJust>Sem conexão com a internet no momento da venda</xJust>");
  });

  it("rejeita data de emissão inválida", () => {
    expect(() => montarXmlNfce(buildInput({ dataHoraEmissao: "não-é-data" }))).toThrow();
  });
});
