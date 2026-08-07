import { describe, expect, it } from "vitest";
import { hashQrCode, montarUrlQrCodeNfce } from "../src/qrcode-nfce.js";

const CHAVE = "15260812345678000199650010000001441000344449";
const URL_CONSULTA = "https://www.sefa.pa.gov.br/nfce/qrcode";

describe("hashQrCode", () => {
  it("é determinístico para a mesma entrada", () => {
    const a = hashQrCode(CHAVE, "2", "000001", "segredo-csc");
    const b = hashQrCode(CHAVE, "2", "000001", "segredo-csc");
    expect(a).toBe(b);
  });

  it("muda se o token do CSC mudar", () => {
    const a = hashQrCode(CHAVE, "2", "000001", "segredo-csc");
    const b = hashQrCode(CHAVE, "2", "000001", "outro-segredo");
    expect(a).not.toBe(b);
  });

  it("muda se o ambiente (tpAmb) mudar", () => {
    const homolog = hashQrCode(CHAVE, "2", "000001", "segredo-csc");
    const producao = hashQrCode(CHAVE, "1", "000001", "segredo-csc");
    expect(homolog).not.toBe(producao);
  });

  it("é um SHA-1 em hex maiúsculo (40 caracteres)", () => {
    const hash = hashQrCode(CHAVE, "2", "000001", "segredo-csc");
    expect(hash).toMatch(/^[0-9A-F]{40}$/);
  });
});

describe("montarUrlQrCodeNfce", () => {
  it("monta a URL no formato p=chave|versao|tpAmb|idCsc|hash", () => {
    const url = montarUrlQrCodeNfce({
      chaveAcesso: CHAVE,
      tpAmb: "2",
      idCsc: "000001",
      cscToken: "segredo-csc",
      urlConsulta: URL_CONSULTA,
    });

    expect(url.startsWith(`${URL_CONSULTA}?p=`)).toBe(true);
    const p = new URL(url).searchParams.get("p")!;
    const [chave, versao, tpAmb, idCsc, hash] = p.split("|");
    expect(chave).toBe(CHAVE);
    expect(versao).toBe("2");
    expect(tpAmb).toBe("2");
    expect(idCsc).toBe("000001");
    expect(hash).toHaveLength(40);
  });

  it("nunca inclui o token do CSC na URL resultante", () => {
    const url = montarUrlQrCodeNfce({
      chaveAcesso: CHAVE,
      tpAmb: "1",
      idCsc: "000001",
      cscToken: "segredo-super-secreto",
      urlConsulta: URL_CONSULTA,
    });
    expect(url).not.toContain("segredo-super-secreto");
  });

  it("rejeita chave que não tem 44 dígitos", () => {
    expect(() =>
      montarUrlQrCodeNfce({
        chaveAcesso: "123",
        tpAmb: "1",
        idCsc: "000001",
        cscToken: "segredo",
        urlConsulta: URL_CONSULTA,
      }),
    ).toThrow();
  });

  it("rejeita CSC token ausente", () => {
    expect(() =>
      montarUrlQrCodeNfce({
        chaveAcesso: CHAVE,
        tpAmb: "1",
        idCsc: "000001",
        cscToken: "",
        urlConsulta: URL_CONSULTA,
      }),
    ).toThrow();
  });
});
