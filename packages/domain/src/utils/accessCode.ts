/**
 * Código de acesso da criança — a identidade física dela dentro do parque.
 *
 * Formato: 11 caracteres do alfabeto Crockford Base32 (`0-9 A-Z` sem I, L,
 * O, U), sendo 8 sorteados criptograficamente e 3 de verificação. Impresso
 * igual na pulseira e no recibo de guarda: são duas vias do mesmo bilhete,
 * de modo que perder uma não impede a saída pela outra.
 *
 * A geração e a conferência do dígito verificador vivem SÓ no banco
 * (migration 20260807000007), com um segredo que nunca chega ao navegador.
 * Este arquivo trata apenas de normalizar e apresentar — nada aqui decide
 * se um código é autêntico.
 */

export const ACCESS_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ACCESS_CODE_LENGTH = 11;

/**
 * Aceita o que veio da câmera ou da digitação do operador e devolve a forma
 * canônica: sem hífen, sem espaço, em maiúsculas, com as confusões clássicas
 * de leitura desfeitas (I e L viram 1, O vira 0 — regra do Crockford).
 *
 * Espelha `fa_kiosk_normalize_access_code` no banco. O `U` não é remapeado:
 * ele não pertence ao alfabeto, então um código com U reprova na verificação.
 */
export function normalizeAccessCode(raw: string | null | undefined): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** Tem a cara de um código de acesso? Não diz se é autêntico — só se vale a pena consultar o banco. */
export function looksLikeAccessCode(raw: string | null | undefined): boolean {
  const code = normalizeAccessCode(raw);
  if (code.length !== ACCESS_CODE_LENGTH) return false;
  return [...code].every((c) => ACCESS_CODE_ALPHABET.includes(c));
}

/**
 * Forma de leitura humana: `K7M2-P9QX-3B7`.
 *
 * Os grupos de 4 existem para o caso em que a câmera não é opção e alguém
 * precisa ditar o código por telefone ou conferir a olho contra a tela.
 */
export function formatAccessCode(raw: string | null | undefined): string {
  const code = normalizeAccessCode(raw);
  if (code.length !== ACCESS_CODE_LENGTH) return code || "—";
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}
