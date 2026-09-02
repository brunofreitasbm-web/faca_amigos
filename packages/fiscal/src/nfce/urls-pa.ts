/**
 * URLs oficiais da SEFA-PA para NFC-e (consulta por QR Code e por chave de
 * acesso), por ambiente. Fonte: nfce.sefa.pa.gov.br/index.php/desenvolvedor
 * (2026-09) — RECONFIRMAR antes de emitir em produção real, o portal estava
 * fora do ar no momento em que isto foi escrito.
 */
export const URLS_NFCE_PA = {
  PRODUCAO: {
    qrCode: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/consultanfce.seam",
    urlChave: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
  },
  HOMOLOGACAO: {
    qrCode: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/consultanfce.seam",
    urlChave: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
  },
} as const;
