/**
 * Data no formato brasileiro digitável (DD/MM/AAAA) convertida de/para o
 * ISO (AAAA-MM-DD) que o banco e os contratos exigem.
 *
 * Existe porque `<input type="date">` no celular abre o seletor nativo e
 * não deixa digitar: para uma data de nascimento (o caso do check-in) o
 * seletor obriga o operador a navegar anos para trás com o polegar, o que
 * é muito mais lento do que teclar oito dígitos. Aqui a máscara é a mesma
 * do CPF — formata a cada tecla, guarda o texto mascarado no estado, e só
 * normaliza para ISO na submissão.
 */

/** Só os dígitos, no máximo 8 (DDMMAAAA). */
export function dateDigitsBr(value: string): string {
  if (!value) return "";
  return value.replace(/\D/g, "").slice(0, 8);
}

/** Formata "31122020" -> "31/12/2020" progressivamente, enquanto digita. */
export function formatDateBr(value: string): string {
  const digits = dateDigitsBr(value);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Valida uma data brasileira completa. Rejeita dia/mês fora de faixa e
 * datas que não existem no calendário (31/02, 31/04, 29/02 fora de
 * bissexto) — o `Date` do JS aceitaria todas elas rolando para o mês
 * seguinte, então a conferência é feita comparando os componentes.
 */
export function isValidDateBr(value: string): boolean {
  const digits = dateDigitsBr(value);
  if (digits.length !== 8) return false;

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2200) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * "31/12/2020" -> "2020-12-31". Devolve "" quando a data ainda está
 * incompleta ou é inválida, para o chamador nunca mandar lixo ao banco.
 */
export function isoFromDateBr(value: string): string {
  if (!isValidDateBr(value)) return "";
  const digits = dateDigitsBr(value);
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

/**
 * "2020-12-31" -> "31/12/2020". Usado ao preencher o campo com um valor
 * que veio do banco (já ISO). Entrada não-ISO volta inalterada.
 */
export function dateBrFromIso(iso: string): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
