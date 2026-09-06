import { describe, expect, it } from "vitest";
import { URLS_NFCE_PA } from "../src/nfce/urls-pa.js";

/**
 * Regressão do cStat 395 ("Endereço do site da UF da consulta via
 * QR-Code diverge do previsto").
 *
 * `qrCode` apontava para `.../consultanfce.seam`. A SEFAZ rejeitou em
 * homologação em 2026-09-02 — com a nota já assinada, transmitida e com
 * schema/conteúdo aceitos, ela ainda comparou o domínio+path do QR Code
 * contra o valor registrado no ENCAT (http://nfce.encat.org/desenvolvedor/qrcode/,
 * fonte nacional oficial) e recusou.
 *
 * Para o Pará, `qrCode` e `urlChave` são a MESMA página (`nfceForm.seam`)
 * nos dois ambientes — não dois arquivos diferentes do portal.
 */
describe("URLS_NFCE_PA", () => {
  it("qrCode e urlChave apontam para nfceForm.seam, nunca consultanfce.seam", () => {
    for (const ambiente of ["PRODUCAO", "HOMOLOGACAO"] as const) {
      const urls = URLS_NFCE_PA[ambiente];
      expect(urls.qrCode, `${ambiente}: qrCode é cStat 395 se não for nfceForm.seam`).toMatch(
        /\/nfceForm\.seam$/,
      );
      expect(urls.qrCode).not.toContain("consultanfce.seam");
      expect(urls.qrCode).toBe(urls.urlChave);
    }
  });

  it("homologação e produção usam paths distintos do portal appnfc.sefa.pa.gov.br", () => {
    expect(URLS_NFCE_PA.PRODUCAO.qrCode).toContain("/portal/");
    expect(URLS_NFCE_PA.HOMOLOGACAO.qrCode).toContain("/portal-homologacao/");
  });
});
