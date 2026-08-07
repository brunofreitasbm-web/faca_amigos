import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extrairChaveECertificadoPem,
  hasCertificateInstalled,
  installCertificate,
  parseCertificadoMeta,
  readCertificadoMetaFromVault,
  readCredentials,
  type CofreCrypto,
} from "../src/fiscal/vault.js";

// Cofre de teste em base64 puro — nunca use isto fora de testes. A
// implementação real (electron-crypto.ts) usa safeStorage/DPAPI e só roda
// dentro do Electron, por isso não pode ser exercitada aqui.
const fakeCrypto: CofreCrypto = {
  encrypt: (plain) => Buffer.from(plain, "utf-8"),
  decrypt: (cipher) => cipher.toString("utf-8"),
};

function gerarPfxDeTeste(senha: string, cnpj = "12345678000199"): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  const attrs = [{ name: "commonName", value: `FACAAMIGOS LTDA:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, senha, { algorithm: "3des" });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, "binary");
}

let userDataPath: string;

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), "fa-fiscal-vault-"));
});

afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true });
});

describe("parseCertificadoMeta", () => {
  it("lê CN, CNPJ e validade de um .pfx válido", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    const meta = parseCertificadoMeta(pfx, "minhasenha");
    expect(meta.subjectCn).toBe("FACAAMIGOS LTDA:12345678000199");
    expect(meta.cnpj).toBe("12345678000199");
    expect(meta.notAfterMs).toBe(new Date("2027-01-01T00:00:00Z").getTime());
  });

  it("rejeita senha errada com mensagem clara", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    expect(() => parseCertificadoMeta(pfx, "senha-errada")).toThrow(/senha/i);
  });

  it("retorna cnpj null quando o CN não segue o padrão razão:cnpj", () => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    const attrs = [{ name: "commonName", value: "Certificado sem padrão ICP" }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, "senha", { algorithm: "3des" });
    const pfx = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

    const meta = parseCertificadoMeta(pfx, "senha");
    expect(meta.cnpj).toBeNull();
  });
});

describe("extrairChaveECertificadoPem", () => {
  it("extrai chave privada e certificado em PEM utilizáveis pela assinatura XMLDSig", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    const { certPem, privateKeyPem } = extrairChaveECertificadoPem(pfx, "minhasenha");
    expect(certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(privateKeyPem).toContain("PRIVATE KEY-----");
  });
});

describe("installCertificate / readCredentials / readCertificadoMetaFromVault", () => {
  it("recusa instalar quando a senha está errada — nada é gravado no cofre", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    expect(() =>
      installCertificate({ userDataPath, pfxBuffer: pfx, password: "errada", cscToken: null, crypto: fakeCrypto }),
    ).toThrow();
    expect(hasCertificateInstalled(userDataPath)).toBe(false);
  });

  it("instala, e depois lê de volta o mesmo .pfx, senha e CSC", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    installCertificate({
      userDataPath,
      pfxBuffer: pfx,
      password: "minhasenha",
      cscToken: "token-csc-123",
      crypto: fakeCrypto,
    });

    expect(hasCertificateInstalled(userDataPath)).toBe(true);

    const creds = readCredentials({ userDataPath, crypto: fakeCrypto });
    expect(creds).not.toBeNull();
    expect(creds!.password).toBe("minhasenha");
    expect(creds!.cscToken).toBe("token-csc-123");
    expect(creds!.pfxBuffer.equals(pfx)).toBe(true);
  });

  it("readCredentials retorna null quando nada foi instalado", () => {
    expect(readCredentials({ userDataPath, crypto: fakeCrypto })).toBeNull();
  });

  it("readCertificadoMetaFromVault devolve os metadados do certificado instalado", () => {
    const pfx = gerarPfxDeTeste("minhasenha", "98765432000188");
    installCertificate({ userDataPath, pfxBuffer: pfx, password: "minhasenha", cscToken: null, crypto: fakeCrypto });

    const meta = readCertificadoMetaFromVault({ userDataPath, crypto: fakeCrypto });
    expect(meta?.cnpj).toBe("98765432000188");
  });

  it("cscToken fica null quando nenhum CSC foi informado na instalação", () => {
    const pfx = gerarPfxDeTeste("minhasenha");
    installCertificate({ userDataPath, pfxBuffer: pfx, password: "minhasenha", cscToken: null, crypto: fakeCrypto });
    const creds = readCredentials({ userDataPath, crypto: fakeCrypto });
    expect(creds!.cscToken).toBeNull();
  });
});
