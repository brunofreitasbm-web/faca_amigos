/**
 * Normaliza um número de telefone informado pelo usuário para o formato E.164 brasileiro (+55DDDNNNNNNNNN).
 * Aceita entradas com ou sem máscara, ex:
 * - "91999999999" -> "+5591999999999"
 * - "(91) 99999-9999" -> "+5591999999999"
 * - "+5591999999999" -> "+5591999999999"
 * - "5591999999999" -> "+5591999999999"
 */
export function normalizePhoneE164(phone: string): string {
  if (!phone) return phone;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return `+${digits}`;
  }
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  return trimmed;
}
