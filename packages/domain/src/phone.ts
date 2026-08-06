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

/**
 * DDDs em uso no Brasil. A lista é explícita (e não uma faixa 11-99) porque
 * há buracos reais — 20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52, 56-60, 70,
 * 72, 76, 78 e 80 não existem — e digitar um deles é justamente o erro de
 * tecla que a validação precisa pegar no balcão.
 */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Extrai só os dígitos nacionais (DDD + número), descartando o +55 quando
 * presente. Aceita tanto o que o operador digita quanto o E.164 que volta
 * do banco.
 */
export function phoneDigitsBr(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Valida um telefone brasileiro: DDD existente + número de celular (9
 * dígitos começando com 9) ou de fixo (8 dígitos começando de 2 a 5).
 *
 * O nono dígito é obrigatório em celular desde 2016 em todo o país — sem
 * essa checagem, um celular antigo de 8 dígitos passaria e o WhatsApp do
 * responsável nunca receberia mensagem, que é o único uso real do campo.
 */
export function isValidPhoneBr(phone: string): boolean {
  const digits = phoneDigitsBr(phone);
  if (digits.length !== 10 && digits.length !== 11) return false;
  if (!DDDS_VALIDOS.has(Number(digits.slice(0, 2)))) return false;

  const subscriber = digits.slice(2);
  if (subscriber.length === 9) return subscriber.startsWith("9");
  return /^[2-5]/.test(subscriber);
}

/**
 * Formata para "(91) 98250-1215" (celular) ou "(91) 3200-0000" (fixo)
 * enquanto o usuário digita. Igual a formatCpf: recebe o texto parcial,
 * devolve o texto parcial já mascarado, e nunca passa de 11 dígitos.
 */
export function formatPhoneBr(phone: string): string {
  const digits = phoneDigitsBr(phone).slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  // Com 10 dígitos o traço cai depois de 4 (fixo); com 11, depois de 5
  // (celular). Enquanto o número está incompleto o palpite de fixo é o
  // que mantém o cursor estável — só pula ao digitar o 11º dígito.
  const breakAt = digits.length <= 10 ? 4 : 5;
  if (subscriber.length <= breakAt) return `(${ddd}) ${subscriber}`;
  return `(${ddd}) ${subscriber.slice(0, breakAt)}-${subscriber.slice(breakAt)}`;
}
