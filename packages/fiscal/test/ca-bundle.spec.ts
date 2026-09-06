import { rootCertificates } from "node:tls";
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ICP_BRASIL_CA_PEMS, montarCaBundle } from "../src/nfce/ca-bundle.js";

/**
 * Este arquivo ficou meses passando com a lista VAZIA: as asserções eram
 * "maior ou igual a zero" e "o loop não roda", então o placeholder nunca
 * falhou um teste. Em produção, toda NFC-e era montada, assinada e
 * numerada e só morria no handshake com "unable to get local issuer
 * certificate" — que parece problema do certificado A1 do emitente.
 *
 * As asserções agora exigem a cadeia de verdade.
 */
describe("montarCaBundle", () => {
  it("tem a cadeia ICP-Brasil — a lista vazia é justamente o bug que quebrou a emissão", () => {
    expect(ICP_BRASIL_CA_PEMS.length).toBeGreaterThan(0);
    expect(montarCaBundle().length).toBe(rootCertificates.length + ICP_BRASIL_CA_PEMS.length);
  });

  it("todo PEM é um certificado X.509 válido", () => {
    for (const pem of ICP_BRASIL_CA_PEMS) {
      expect(() => new X509Certificate(pem)).not.toThrow();
    }
  });

  it("inclui a AC Raiz Brasileira — é ela que falta no store da Mozilla", () => {
    const assuntos = ICP_BRASIL_CA_PEMS.map((pem) => new X509Certificate(pem).subject);
    expect(assuntos.some((s) => /Autoridade Certificadora Raiz Brasileira/i.test(s))).toBe(true);
  });

  /**
   * Os dois certificados expiram em 01/07/2032. Quando isso acontecer a
   * emissão para de novo, com a mesma mensagem enganosa. Falhar o build
   * com 90 dias de antecedência dá tempo de trocar sem parar o balcão.
   */
  it("nenhum certificado expira nos próximos 90 dias", () => {
    const limite = Date.now() + 90 * 24 * 60 * 60 * 1000;
    for (const pem of ICP_BRASIL_CA_PEMS) {
      const cert = new X509Certificate(pem);
      expect(
        Date.parse(cert.validTo),
        `${cert.subject} expira em ${cert.validTo} — renove a cadeia em src/nfce/ca-bundle.ts`,
      ).toBeGreaterThan(limite);
    }
  });
});
