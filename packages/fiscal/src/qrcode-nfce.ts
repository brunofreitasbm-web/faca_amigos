function sha1Hex(str: string): string {
  function rotateLeft(n: number, s: number) {
    return (n << s) | (n >>> (32 - s));
  }
  const utf8 = new TextEncoder().encode(str);
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    const idx = i >> 2;
    words[idx] = (words[idx] ?? 0) | (utf8[i]! << (24 - (i % 4) * 8));
  }
  const bitLength = utf8.length * 8;
  const bitIdx = bitLength >> 5;
  words[bitIdx] = (words[bitIdx] ?? 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  let e = -1009589776;

  for (let i = 0; i < words.length; i += 16) {
    const w = new Int32Array(80);
    for (let j = 0; j < 16; j++) w[j] = words[i + j] || 0;
    for (let j = 16; j < 80; j++) {
      w[j] = rotateLeft(w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!, 1);
    }

    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let j = 0; j < 80; j++) {
      let f = 0;
      let k = 0;
      if (j < 20) {
        f = (B & C) | (~B & D);
        k = 1518500249;
      } else if (j < 40) {
        f = B ^ C ^ D;
        k = 1859775393;
      } else if (j < 60) {
        f = (B & C) | (B & D) | (C & D);
        k = -1894007588;
      } else {
        f = B ^ C ^ D;
        k = -899497514;
      }
      const temp = (rotateLeft(A, 5) + f + E + k + w[j]!) | 0;
      E = D;
      D = C;
      C = rotateLeft(B, 30);
      B = A;
      A = temp;
    }
    a = (a + A) | 0;
    b = (b + B) | 0;
    c = (c + C) | 0;
    d = (d + D) | 0;
    e = (e + E) | 0;
  }

  return [a, b, c, d, e]
    .map((val) => (val >>> 0).toString(16).padStart(8, "0"))
    .join("")
    .toUpperCase();
}

const QRCODE_VERSAO = "2";

export interface QrCodeNfceInput {
  chaveAcesso: string;
  tpAmb: "1" | "2";
  idCsc: string;
  cscToken: string;
  urlConsulta: string;
}

/**
 * Normaliza o id do CSC removendo zeros não significativos — o Manual de
 * Especificações Técnicas do DANFE NFC-e e QR Code exige o id "sem os
 * zeros não significativos" tanto no hash quanto na URL (ex.: "000001"
 * vira "1"). Entrada não numérica/vazia cai para "0".
 */
function normalizarIdCsc(idCsc: string): string {
  return String(Number(idCsc.replace(/\D/g, "")) || 0);
}

/** SHA-1 em hex maiúsculo, como o hash do QR Code exige. */
export function hashQrCode(chaveAcesso: string, tpAmb: string, idCsc: string, cscToken: string): string {
  const chave = chaveAcesso.replace(/\D/g, "");
  const idCscNormalizado = normalizarIdCsc(idCsc);
  const input = `${chave}${QRCODE_VERSAO}${tpAmb}${idCscNormalizado}${cscToken}`;
  return sha1Hex(input);
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
  const idCscNormalizado = normalizarIdCsc(input.idCsc);
  const p = [chave, QRCODE_VERSAO, input.tpAmb, idCscNormalizado, hash].join("|");
  return `${input.urlConsulta}?p=${p}`;
}
