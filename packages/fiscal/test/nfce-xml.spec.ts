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

  it("inclui o CPF do consumidor quando informado (produção mantém o nome real)", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        ambiente: "PRODUCAO",
        destinatario: { cpf: "12345678909", nome: "Maria Souza" },
      }),
    );
    expect(xml).toContain("<CPF>12345678909</CPF>");
    expect(xml).toContain("<xNome>Maria Souza</xNome>");
    expect(xml).toContain("<indIEDest>9</indIEDest>");
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

  it("dhEmi usa offset local America/Belem, sem 'Z' nem milissegundos", () => {
    const { xml } = montarXmlNfce(buildInput({ dataHoraEmissao: "2026-08-07T14:30:00-03:00" }));
    const match = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/);
    expect(match?.[1]).toMatch(/-03:00$/);
    expect(match?.[1]).not.toContain("Z");
    expect(match?.[1]).not.toContain(".");
  });

  it("o AAMM da chave de acesso reflete o mês LOCAL mesmo perto da virada UTC", () => {
    // 23:30 de 31/08 em Belém (UTC-03:00) é 02:30 de 01/09 em UTC — a chave
    // precisa carregar agosto (08), não setembro (09).
    const { chaveAcesso } = montarXmlNfce(buildInput({ dataHoraEmissao: "2026-08-31T23:30:00-03:00" }));
    const aamm = chaveAcesso.slice(2, 6);
    expect(aamm).toBe("2608");
  });

  it("rejeita codigoNumerico igual ao número da nota, aceita quando diferente", () => {
    expect(() =>
      montarXmlNfce(buildInput({ numero: 5, codigoNumerico: "00000005" })),
    ).toThrow();

    expect(() =>
      montarXmlNfce(buildInput({ numero: 5, codigoNumerico: "00000009" })),
    ).not.toThrow();
  });

  it("separa PIS/COFINS em NT quando o CST indica não tributado", () => {
    const { xml } = montarXmlNfce(
      buildInput({
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
            pisCst: "04",
            cofinsCst: "49",
          },
        ],
      }),
    );

    expect(xml).toContain("<PISNT><CST>04</CST></PISNT>");
    expect(xml).not.toMatch(/<PISNT>[^<]*<vPIS>/);
    expect(xml).toContain("<COFINSOutr>");
    expect(xml).toMatch(/<COFINSOutr>.*<vCOFINS>0\.00<\/vCOFINS>.*<\/COFINSOutr>/);
  });

  it("usa ICMSSN500 (substituição tributária) quando o CSOSN do item é 500, e ICMSSN102 nos demais", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        itens: [
          {
            descricao: "Água mineral 500ml",
            quantidade: 1,
            valorUnitario: 5,
            valorTotal: 5,
            ncm: "22011000",
            cest: "0300500",
            cfop: "5102",
            csosn: "500",
            origem: 0,
            unidadeComercial: "UN",
            gtin: "SEM GTIN",
            pisCst: "04",
            cofinsCst: "04",
          },
        ],
      }),
    );

    expect(xml).toContain("<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500>");
    expect(xml).not.toContain("ICMSSN102");
  });

  it("em homologação, força os textos fixos do MOC no primeiro item e no destinatário", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        ambiente: "HOMOLOGACAO",
        destinatario: { cpf: "12345678909", nome: "Maria Souza" },
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
          {
            descricao: "Salgadinho artesanal",
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
        pagamentos: [{ metodo: "DINHEIRO", valor: 12.5 }],
      }),
    );

    expect(xml).toContain(
      "<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>",
    );
    expect(xml).toContain("<xProd>Salgadinho artesanal</xProd>");
    expect(xml).toContain(
      "<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>",
    );
    expect(xml).toContain("<indIEDest>9</indIEDest>");
  });

  it("em produção, mantém as descrições reais dos itens", () => {
    const { xml } = montarXmlNfce(buildInput({ ambiente: "PRODUCAO" }));
    expect(xml).toContain("<xProd>Água mineral 500ml</xProd>");
    expect(xml).not.toContain("HOMOLOGACAO");
  });

  it("monta infNFeSupl com o QR Code quando input.qrCode é informado, e omite quando não", () => {
    const comQrCode = montarXmlNfce(
      buildInput({
        qrCode: {
          idCsc: "000001",
          cscToken: "segredo-csc",
          urlConsulta: "https://www.sefa.pa.gov.br/nfce/qrcode",
          urlChave: "https://www.sefa.pa.gov.br/nfce/consulta",
        },
      }),
    );
    expect(comQrCode.qrCodeUrl).toBeTruthy();
    expect(comQrCode.xml).toContain("<infNFeSupl>");
    expect(comQrCode.xml).toContain("<urlChave>https://www.sefa.pa.gov.br/nfce/consulta</urlChave>");
    expect(comQrCode.xml.indexOf("</infNFe>")).toBeLessThan(comQrCode.xml.indexOf("<infNFeSupl>"));

    const semQrCode = montarXmlNfce(buildInput());
    expect(semQrCode.qrCodeUrl).toBeNull();
    expect(semQrCode.xml).not.toContain("infNFeSupl");
  });

  it("remove a máscara do CNPJ do emitente antes de gerar o XML", () => {
    const { xml } = montarXmlNfce(
      buildInput({
        emitente: {
          ...buildInput().emitente,
          cnpj: "12.345.678/0001-99",
        },
      }),
    );
    expect(xml).toContain("<CNPJ>12345678000199</CNPJ>");
    expect(xml).not.toContain("12.345.678/0001-99");
  });
});
