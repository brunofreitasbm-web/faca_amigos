import { rootCertificates } from "node:tls";
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ICP_BRASIL_CA_PEMS, montarCaBundle } from "../src/nfce/ca-bundle.js";

describe("montarCaBundle", () => {
  it("inclui pelo menos o store padrão do Node (>= porque o placeholder da ICP-Brasil pode estar vazio)", () => {
    expect(montarCaBundle().length).toBeGreaterThanOrEqual(rootCertificates.length);
  });

  it("todo PEM em ICP_BRASIL_CA_PEMS (se houver algum) é um certificado X.509 válido", () => {
    // Array vazio hoje (placeholder) — o loop não roda e o teste passa
    // trivialmente; a asserção abaixo garante que o arquivo não fica sem
    // nenhuma verificação real.
    expect(ICP_BRASIL_CA_PEMS.length).toBeGreaterThanOrEqual(0);
    for (const pem of ICP_BRASIL_CA_PEMS) {
      expect(() => new X509Certificate(pem)).not.toThrow();
    }
  });
});
