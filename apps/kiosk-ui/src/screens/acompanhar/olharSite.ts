/**
 * Link do Olhar FaçaAmigos (PDF) para a tela de acompanhamento depois do
 * checkout. É o mesmo endereço do botão do WhatsApp: a função session-report-view
 * troca o token por uma URL assinada de 1 hora e redireciona para o PDF.
 */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://ivjvpdzsfjdpyabbzzuj.supabase.co";

/** Mesma regra de session-report-view: token de 40 a 64 caracteres URL-safe. */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export function olharUrl(reportToken: string | null | undefined): string | null {
  if (!reportToken || !TOKEN_RE.test(reportToken)) return null;
  return `${SUPABASE_URL}/functions/v1/session-report-view?t=${reportToken}`;
}
