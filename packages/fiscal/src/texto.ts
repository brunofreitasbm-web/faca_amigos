/**
 * Sanitização de texto para campos fiscais (DPS nacional e NFC-e) — ambos os
 * layouts usam faixa de caracteres ISO-8859-1 (Latin-1) nos campos de texto
 * livre (xProd, xNome, xLgr, xBairro, xDescServ etc.), então qualquer coisa
 * fora dessa faixa (emoji, tipografia "esperta" de editor de texto,
 * caracteres de outros alfabetos) precisa ser normalizada ou removida antes
 * de entrar no XML — senão o SEFAZ/SEFIN rejeita o documento ou, pior,
 * autoriza um XML com bytes que não correspondem ao layout declarado.
 *
 * NBSP e os caracteres de controle são tratados por código numérico
 * (charCode/codePoint), não por regex com escape literal, para não
 * depender de como cada ferramenta no caminho do arquivo lida com bytes
 * invisíveis dentro do próprio código-fonte.
 */

/** Travessão/meia-risca/hífen Unicode/sinal de menos → hífen ASCII simples. */
const TRACOS = /[—–‐−]/g;
/** Aspas duplas curvas (esquerda/direita) → aspas retas ("). */
const ASPAS_DUPLAS = /[“”]/g;
/** Aspas simples curvas (esquerda/direita) → apóstrofo reto ('). */
const ASPAS_SIMPLES = /[‘’]/g;
/** Reticências tipográficas (um único caractere) → três pontos ASCII. */
const RETICENCIAS = /…/g;

/** Espaço não separável (NBSP) — via código numérico (160), não regex. */
const NBSP_CHAR = String.fromCharCode(160);

/** Maior code point ainda dentro de Latin-1 (0x00FF = "ÿ"). */
const LATIN1_MAX = 0x00ff;
/** Fim do bloco de controle C0 (0x00-0x1F). */
const C0_MAX = 0x1f;
/** Início/fim do bloco de controle C1 (0x7F-0x9F). */
const C1_MIN = 0x7f;
const C1_MAX = 0x9f;

function isControlOuForaDeLatin1(codePoint: number): boolean {
  if (codePoint <= C0_MAX) return true;
  if (codePoint >= C1_MIN && codePoint <= C1_MAX) return true;
  return codePoint > LATIN1_MAX;
}

/**
 * Normaliza e sanitiza um texto para uso em campos fiscais de faixa
 * ISO-8859-1: normaliza para NFC, troca variantes tipográficas comuns por
 * seus equivalentes ASCII, remove caracteres de controle e qualquer coisa
 * fora de Latin-1, colapsa espaços e trunca no tamanho máximo do campo.
 */
export function sanitizarTextoFiscal(s: string, max = 255): string {
  let out = s.normalize("NFC");

  out = out
    .replace(TRACOS, "-")
    .replace(ASPAS_DUPLAS, '"')
    .replace(ASPAS_SIMPLES, "'")
    .replace(RETICENCIAS, "...")
    .split(NBSP_CHAR)
    .join(" ");

  // Remove caracteres de controle e qualquer coisa fora de Latin-1 (emoji,
  // alfabetos não latinos etc.) — itera por code point para não quebrar
  // pares substitutos (surrogate pairs) de caracteres astrais no meio.
  out = Array.from(out)
    .filter((ch) => !isControlOuForaDeLatin1(ch.codePointAt(0) ?? 0))
    .join("");

  out = out.replace(/\s+/g, " ").trim();

  return out.slice(0, max);
}

/**
 * Mesma sanitização de `sanitizarTextoFiscal`, com o default de tamanho
 * usado pelos campos de texto da NFC-e (xProd/xNome/xLgr/xBairro), que
 * também usam a faixa ISO-8859-1 igual à DPS nacional.
 */
export function sanitizarTextoNfe(s: string, max = 60): string {
  return sanitizarTextoFiscal(s, max);
}
