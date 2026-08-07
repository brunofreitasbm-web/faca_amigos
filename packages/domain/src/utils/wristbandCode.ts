/**
 * Formata e encurta um código de pulseira bruto (ex.: payload "FA1|W|<shortId>|<hmac>",
 * UUID ou hash hex) em um identificador curto e amigável para exibição em tela.
 */
export function getFriendlyWristbandCode(code?: string | null): string {
  if (!code) return "—";

  const clean = code.trim().replace(/^#/, "");

  // Se o código estiver no formato codificado "FA1|W|<sessionShortId>|<hmac>" ou "FA1|T|..."
  if (clean.includes("|")) {
    const parts = clean.split("|");
    if (parts.length >= 3 && parts[2]) {
      return parts[2].slice(0, 8).toUpperCase();
    }
  }

  // Se for uma hash/uuid longa (> 12 caracteres sem espaços)
  if (clean.length > 12 && !clean.includes(" ")) {
    return clean.slice(0, 8).toUpperCase();
  }

  return clean.toUpperCase();
}
