import { describe, expect, it } from "vitest";
import { montarIdDps, montarXmlDps, type DpsInput } from "../src/dps-nacional-xml.js";

function buildInput(overrides: Partial<DpsInput> = {}): DpsInput {
  return {
    ambiente: "HOMOLOGACAO",
    dataHoraEmissao: new Date("2026-08-07T14:30:00-03:00"),
    dataCompetencia: new Date("2026-08-07T14:30:00-03:00"),
    serieDps: "1",
    numeroDps: 42,
    codigoMunicipioIbge: "1501402",
    prestador: { cnpj: "12345678000199", inscricaoMunicipal: null },
    tomador: { cpf: "12345678909", nome: "Maria Souza" },
    codigoTribNacional: "120501",
    codigoTribMunicipal: null,
    descricaoServico: "Sessão de aniversário no playground",
    enderecoEvento: {
      cep: "66635110",
      logradouro: "Rod. Augusto Montenegro",
      numero: "s/n",
      complemento: "Parque Shopping Belém",
      bairro: "Parque Verde",
    },
    valorServico: 250,
    aliquotaIssManual: null,
    ...overrides,
  };
}

describe("montarXmlDps", () => {
  it("sanitiza travessão em xDescServ e no xNome do atvEvento", () => {
    const { xml } = montarXmlDps(
      buildInput({ descricaoServico: "Aniversário — pacote completo" }),
    );
    expect(xml).toContain("<xDescServ>Aniversário - pacote completo</xDescServ>");
    expect(xml).toContain("<xNome>Aniversário - pacote completo</xNome>");
    expect(xml).not.toContain("—");
  });

  it("omite cTribMun quando o código é '0' ou nulo, e inclui quando é um código real", () => {
    const zero = montarXmlDps(buildInput({ codigoTribMunicipal: "0" }));
    expect(zero.xml).not.toContain("<cTribMun>");

    const nulo = montarXmlDps(buildInput({ codigoTribMunicipal: null }));
    expect(nulo.xml).not.toContain("<cTribMun>");

    const valido = montarXmlDps(buildInput({ codigoTribMunicipal: "120501" }));
    expect(valido.xml).toContain("<cTribMun>120501</cTribMun>");
  });

  it("usa a data LOCAL (America/Belem) em dCompet/dtIni/dtFim mesmo quando o instante já é o dia seguinte em UTC", () => {
    // 23:30 de 31/08 em Belém (UTC-03:00) é 02:30 de 01/09 em UTC — a
    // competência/atividade deve refletir o dia local (31/08), não o UTC.
    const d = new Date("2026-08-31T23:30:00-03:00");
    const { xml } = montarXmlDps(buildInput({ dataHoraEmissao: d, dataCompetencia: d }));

    expect(xml).toContain("<dCompet>2026-08-31</dCompet>");
    expect(xml).toContain("<dtIni>2026-08-31</dtIni>");
    expect(xml).toContain("<dtFim>2026-08-31</dtFim>");
    expect(xml).not.toContain("2026-09-01");
    expect(xml).toContain("<dhEmi>2026-08-31T23:30:00-03:00</dhEmi>");
  });

  it("mantém o Id do infDPS (montarIdDps) com exatamente 45 caracteres", () => {
    const id = montarIdDps(buildInput());
    expect(id).toHaveLength(45);

    const { idDps } = montarXmlDps(buildInput());
    expect(idDps).toHaveLength(45);
  });

  it("trunca xNome/xDescServ no tamanho máximo do campo mesmo com entrada muito longa", () => {
    const nomeLongo = "A".repeat(500);
    const descricaoLonga = "B".repeat(500);
    const { xml } = montarXmlDps(
      buildInput({
        tomador: { cpf: "12345678909", nome: nomeLongo },
        descricaoServico: descricaoLonga,
      }),
    );

    const xNomeMatch = xml.match(/<xNome>(A+)<\/xNome>/);
    expect(xNomeMatch?.[1]).toHaveLength(300);

    const xDescServMatch = xml.match(/<xDescServ>(B+)<\/xDescServ>/);
    expect(xDescServMatch?.[1]).toHaveLength(255);
  });
});
