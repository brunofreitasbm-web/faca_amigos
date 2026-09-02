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
//
// POR QUE DUAS RESPOSTAS E NÃO UMA: banco e Edge Function não aceitam mais
// as mesmas chaves. A service_role legada (JWT `eyJ...`) continua valendo
// no PostgREST/Realtime — é com ela que muitos terminais imprimem hoje —,
// mas a Edge Function `nfse-certificate-fetch` compara o bearer contra o
// `SUPABASE_SERVICE_ROLE_KEY` que o runtime injeta, e nos projetos já
// migrados para as chaves novas esse valor NÃO é mais o JWT legado.
// Verificado contra o projeto de produção em 2026-09-02: o JWT legado
// responde 401 "não autorizado" na function e 200 no banco.
//
// Por isso `hasServiceRoleKey` (impressão) é mais permissivo que
// `canFetchFiscalCredentials` (fiscal). Unificar os dois quebraria a
// impressão de pulseira — que é o que trava o balcão na hora — para
// consertar a emissão de nota, um mau negócio.

const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";

/** Prefixo da chave secreta no formato novo do Supabase. */
export const SECRET_KEY_PREFIX = "sb_secret_";
/** Prefixo da chave publicável — nunca serve como credencial de terminal. */
export const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

export type TerminalKeyKind = "secret" | "legacy-jwt" | "publishable" | "none";

export interface TerminalSupabaseKey {
  secretKey: string;
  /** Serve para gravar no banco (print bridge, heartbeat): chave nova OU JWT legado. */
  hasServiceRoleKey: boolean;
  /**
   * Serve para autorizar em `nfse-certificate-fetch`: SÓ a chave nova
   * (`sb_secret_...`). Um JWT legado passa em `hasServiceRoleKey` e mesmo
   * assim leva 401 aqui — é essa diferença que produzia o
   * "Certificado A1 não disponível: não autorizado" sem nenhuma pista.
   */
  canFetchFiscalCredentials: boolean;
  kind: TerminalKeyKind;
}

/** Classifica um valor de chave sem revelar o valor em si (vai para log). */
export function classifyTerminalKey(value: string | undefined | null): TerminalKeyKind {
  const key = value?.trim();
  if (!key) return "none";
  if (key.startsWith(PUBLISHABLE_KEY_PREFIX)) return "publishable";
  if (key.startsWith(SECRET_KEY_PREFIX)) return "secret";
  if (key.startsWith("eyJ")) return "legacy-jwt";
  return "none";
}

export function resolveTerminalSupabaseKey(): TerminalSupabaseKey {
  // A chave nova vence a legada mesmo que as duas estejam preenchidas: é a
  // única que serve para os dois usos.
  const candidatos = [process.env.FACAAMIGOS_SUPABASE_SECRET_KEY, process.env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));

  const secretNova = candidatos.find((v) => classifyTerminalKey(v) === "secret");
  const jwtLegado = candidatos.find((v) => classifyTerminalKey(v) === "legacy-jwt");
  const escolhida = secretNova ?? jwtLegado;
  const kind = classifyTerminalKey(escolhida ?? candidatos[0]);

  const secretKey = escolhida || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY;
  return {
    secretKey,
    hasServiceRoleKey: kind === "secret" || kind === "legacy-jwt",
    canFetchFiscalCredentials: kind === "secret",
    kind,
  };
}
