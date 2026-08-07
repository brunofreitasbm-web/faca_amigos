import { createHash } from "node:crypto";

/**
 * Payload do QR Code da NFC-e (formato "offline", `p=chave|versão|tpAmb|idCSC|hash`),
 * o mesmo publicado nos manuais de várias SEFAZ estaduais. Funciona sem
 * round-trip à internet no momento da consulta pelo cliente — o hash prova
 * a autenticidade sozinho, e é o que exige o CSC (Código de Segurança do
 * Contribuinte) nunca sair do cofre local (ver apps/kiosk/src/fiscal/vault.ts).
 *
 * IMPORTANTE: confirmar este layout byte a byte contra o manual da SEFA-PA
 * obtido na Fase 0 do plano antes da Fase 5 (homologação) — o Pará pode
 * publicar uma variação da URL de consulta, e um pipe fora de ordem invalida
 * o QR Code sem que ninguém perceba até escanear.
 */

const QRCODE_VERSAO = "2";

export interface QrCodeNfceInput {
  /** Chave de acesso de 44 dígitos, já com o DV. */
  chaveAcesso: string;
  /** "1" = produção, "2" = homologação — mesmo código do `tpAmb` do XML. */
  tpAmb: "1" | "2";
  /** Identificador do CSC cadastrado no SEFA-PA (ex. "000001"). Não é secreto. */
  idCsc: string;
  /** Token do CSC. Secreto — nunca loga, nunca persiste fora do cofre local. */
  cscToken: string;
  /** URL de consulta pública do Pará, cadastrada em fa_kiosk_units.nfce_qrcode_url_consulta. */
  urlConsulta: string;
}

/** SHA-1 em hex maiúsculo, como o hash do QR Code exige. */
export function hashQrCode(chaveAcesso: string, tpAmb: string, idCsc: string, cscToken: string): string {
  const chave = chaveAcesso.replace(/\D/g, "");
  const input = `${chave}${QRCODE_VERSAO}${tpAmb}${idCsc}${cscToken}`;
  return createHash("sha1").update(input).digest("hex").toUpperCase();
}

/**
 * Monta a URL completa a codificar no QR Code impresso no DANFE. O `cscToken`
 * entra só para calcular o hash — nunca aparece no resultado.
 */
export function montarUrlQrCodeNfce(input: QrCodeNfceInput): string {
  const chave = input.chaveAcesso.replace(/\D/g, "");
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso precisa ter 44 dígitos, recebeu ${chave.length}`);
  }
  if (!input.cscToken) {
    throw new Error("cscToken ausente — não é possível montar o QR Code sem o CSC do cofre local");
  }

  const hash = hashQrCode(chave, input.tpAmb, input.idCsc, input.cscToken);
  const p = [chave, QRCODE_VERSAO, input.tpAmb, input.idCsc, hash].join("|");
  return `${input.urlConsulta}?p=${p}`;
}
