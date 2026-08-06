/**
 * Remove máscara de um CPF informado pelo usuário, retornando apenas os dígitos.
 * Ex: "123.456.789-09" -> "12345678909"
 */
export function normalizeCpf(cpf: string): string {
  if (!cpf) return cpf;
  return cpf.replace(/\D/g, "");
}

/**
 * Valida um CPF (11 dígitos) conferindo os dois dígitos verificadores.
 * Rejeita sequências de dígitos repetidos (ex: "00000000000"), que passariam
 * no cálculo dos dígitos verificadores mas nunca são CPFs reais.
 */
export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calcCheckDigit = (base: string): number => {
    let sum = 0;
    let weight = base.length + 1;
    for (const char of base) {
      sum += Number(char) * weight;
      weight -= 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstNine = digits.slice(0, 9);
  const digit1 = calcCheckDigit(firstNine);
  const digit2 = calcCheckDigit(firstNine + digit1);

  return digits === firstNine + digit1 + digit2;
}

/**
 * Formata os dígitos de um CPF como "000.000.000-00" enquanto o usuário digita.
 */
export function formatCpf(cpf: string): string {
  const digits = normalizeCpf(cpf).slice(0, 11);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  let formatted = parts.join(".");
  if (digits.length > 9) formatted += `-${digits.slice(9, 11)}`;
  return formatted;
}
