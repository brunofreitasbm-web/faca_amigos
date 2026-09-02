import { describe, expect, it, vi } from "vitest";
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

/**
 * Regressão do cStat 588.
 *
 * A SEFAZ rejeita "caracteres de edição no início/fim da mensagem ou entre
 * as tags". O envelope SOAP e os corpos eram montados com template
 * literal indentado, então cada tag vinha precedida de \n + espaços. Em
 * homologação, 2026-09-02, isso derrubou uma NFC-e já assinada e numerada
 * com "Elemento: enviNFe".
 *
 * O teste inspeciona o payload realmente escrito no socket — formatar o
 * XML "para ficar legível" é justamente o que quebra.
 */
describe("payload SOAP enviado à SVRS", () => {
  it("não tem espaço nem quebra de linha entre as tags", async () => {
    const enviados: string[] = [];

    vi.doMock("node:https", () => ({
      request: (_opts: unknown, cb: (res: unknown) => void) => {
        const res = {
          statusCode: 200,
          on(evento: string, handler: (arg?: unknown) => void) {
            if (evento === "data") handler(Buffer.from("<xml/>"));
            if (evento === "end") handler();
            return res;
          },
        };
        return {
          on: () => undefined,
          write: (corpo: string) => enviados.push(corpo),
          end: () => cb(res),
          destroy: () => undefined,
        };
      },
    }));

    vi.resetModules();
    const { SvrsNfceTransport: Transport } = await import("../src/nfce/svrs-transport.js");
    const transport = new Transport({ certPem: "x", privateKeyPem: "y", timeoutMs: 1000 });
    await transport.consultarStatusServico("HOMOLOGACAO");

    expect(enviados.length).toBeGreaterThan(0);
    const payload = enviados[0]!;
    // `>` seguido de qualquer espaço em branco antes do próximo `<`
    expect(payload, `payload com caracteres de edição entre tags:\n${payload}`).not.toMatch(/>\s+</);
    expect(payload).toContain("<soap12:Body><nfeDadosMsg");
    vi.doUnmock("node:https");
  });
});
