import { describe, expect, it } from "vitest";
import { montarXmlCancelamento, montarXmlInutilizacao } from "../src/eventos-xml.js";

describe("eventos-xml", () => {
  it("deve montar o XML do evento de cancelamento com as tags obrigatórias", () => {
    const { xml, idEvento } = montarXmlCancelamento({
      chaveAcesso: "15260800000000000000650010000000011000000001",
      cnpj: "12345678000195",
      protocolo: "153260000000001",
      justificativa: "Cliente desistiu da compra antes do preparo",
      ambiente: "HOMOLOGACAO",
    });

    expect(idEvento).toBe("ID1101111526080000000000000065001000000001100000000101");
    expect(xml).toContain('<tpEvento>110111</tpEvento>');
    expect(xml).toContain('<cOrgao>15</cOrgao>');
    expect(xml).toContain('Cliente desistiu da compra antes do preparo');
    expect(xml).toContain('<nProt>153260000000001</nProt>');
  });

  it("deve rejeitar justificativa com menos de 15 caracteres para cancelamento", () => {
    expect(() =>
      montarXmlCancelamento({
        chaveAcesso: "15260800000000000000650010000000011000000001",
        cnpj: "12345678000195",
        protocolo: "153260000000001",
        justificativa: "Curto",
        ambiente: "HOMOLOGACAO",
      }),
    ).toThrow("no mínimo 15 caracteres");
  });

  it("deve montar o XML de inutilização de numeração", () => {
    const { xml, idInut } = montarXmlInutilizacao({
      cnpj: "12345678000195",
      ano: 26,
      serie: 1,
      numeroInicial: 10,
      numeroFinal: 12,
      justificativa: "Numeração saltada devido a falha de energia no PDV",
      ambiente: "HOMOLOGACAO",
    });

    expect(idInut).toBe("ID151234567800019565001000000010000000012");
    expect(xml).toContain('<xServ>INUTILIZAR</xServ>');
    expect(xml).toContain('<nNFIni>10</nNFIni>');
    expect(xml).toContain('<nNFFin>12</nNFFin>');
  });
});
