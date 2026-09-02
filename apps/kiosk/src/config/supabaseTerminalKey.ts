// Resolve a chave que o worker fiscal (fiscal/index.ts) e a ponte de
// impressão (main/printBridge.ts) usam pra falar com o Supabase como
// service role.
//
// Detecta não só a ausência de FACAAMIGOS_SUPABASE_SECRET_KEY, mas também o
// erro de configuração que já aconteceu em produção: colar a chave
// PUBLICÁVEL (sb_publishable_...) nessa variável. O valor fica "presente" e
// passaria por um `Boolean(...)` simples, mas não tem nenhuma permissão de
// service role — a Edge Function de certificado sempre responde "não
// autorizado" e a reserva de impressão nunca teria permissão de gravar.

const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";

export interface TerminalSupabaseKey {
  secretKey: string;
  hasServiceRoleKey: boolean;
}

export function resolveTerminalSupabaseKey(): TerminalSupabaseKey {
  const configured = process.env.FACAAMIGOS_SUPABASE_SECRET_KEY || process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY;
  const hasServiceRoleKey = Boolean(configured) && !configured!.startsWith("sb_publishable_");
  const secretKey = configured || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY;
  return { secretKey, hasServiceRoleKey };
}
