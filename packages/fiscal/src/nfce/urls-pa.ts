/**
 * URLs oficiais da SEFA-PA para NFC-e (consulta por QR Code e por chave de
 * acesso), por ambiente.
 *
 * `qrCode` era `.../consultanfce.seam` — SEFAZ rejeitava com cStat 395
 * ("Endereço do site da UF da consulta via QR-Code diverge do previsto"),
 * medido em homologação em 2026-09-02, com a nota já assinada, transmitida
 * e com schema/conteúdo aceitos. A fonte autoritativa para essa validação
 * não é o portal da SEFA-PA (que estava fora do ar), é o registro nacional
 * do ENCAT — http://nfce.encat.org/desenvolvedor/qrcode/ (consultado em
 * 2026-09-02) — que lista `nfceForm.seam` para PA, no mesmo path que
 * `urlChave` já usava. As duas URLs de consulta do PA são, portanto, a
 * MESMA página — nfceForm.seam aceita tanto os parâmetros do QR Code
 * quanto a digitação manual da chave.
 *
 * NÃO troque de volta para consultanfce.seam sem reconferir contra o
 * ENCAT: foi essa troca implícita (alguém preencheu com uma URL que
 * "parecia certa") que causou o cStat 395.
 */
export const URLS_NFCE_PA = {
  PRODUCAO: {
    qrCode: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
    urlChave: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
  },
  HOMOLOGACAO: {
    qrCode: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
    urlChave: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
  },
} as const;
