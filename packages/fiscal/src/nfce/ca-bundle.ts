import { rootCertificates } from "node:tls";

/**
 * Cadeia ICP-Brasil servida pela SVRS (NFC-e). PLACEHOLDER: preencher com os
 * PEMs reais (raiz + intermediárias) obtidos via
 * `openssl s_client -connect nfce.svrs.rs.gov.br:443 -showcerts` (produção) e
 * `nfce-homologacao.svrs.rs.gov.br:443` (homologação), ou do pacote oficial
 * https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip.
 * Sem isso, `montarCaBundle()` só devolve o store padrão do Node e a rejeição
 * "unable to get local issuer certificate" persiste — ver docs/fiscal (TODO).
 */
export const ICP_BRASIL_CA_PEMS: readonly string[] = [
  // TODO(fiscal): colar aqui os certificados PEM da cadeia real, com data e
  // fingerprint SHA-256 em comentário acima de cada um.
];

export function montarCaBundle(): string[] {
  return [...rootCertificates, ...ICP_BRASIL_CA_PEMS];
}
