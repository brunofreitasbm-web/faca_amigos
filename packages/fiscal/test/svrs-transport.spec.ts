import { describe, expect, it } from "vitest";
import { SvrsNfceTransport } from "../src/nfce/svrs-transport.js";

describe("SvrsNfceTransport", () => {
  it("deve instanciar a classe com as opções fornecidas", () => {
    const transport = new SvrsNfceTransport({
      certPem: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
      privateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----",
      timeoutMs: 5000,
    });

    expect(transport).toBeDefined();
    expect(typeof transport.consultarStatusServico).toBe("function");
    expect(typeof transport.autorizar).toBe("function");
    expect(typeof transport.consultarPorChave).toBe("function");
  });

  it("deve retornar erro de conexão formatado se a rede/certificado não responderem", async () => {
    const transport = new SvrsNfceTransport({
      certPem: "INVALID_CERT",
      privateKeyPem: "INVALID_KEY",
      timeoutMs: 1000,
    });

    const status = await transport.consultarStatusServico("HOMOLOGACAO");
    expect(status.online).toBe(false);
    expect(status.cstat).toBe("999");
    expect(status.xmotivo).toBeTruthy();
  });
});
