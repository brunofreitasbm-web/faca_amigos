/**
 * Versão do protocolo de sincronização e da API HTTP/WS entre tablets,
 * o servidor local (Electron main) e as Edge Functions do Supabase.
 *
 * Incrementar quando um payload muda de forma incompatível. O servidor
 * recusa envelopes de sync com versão desconhecida (ver packages/sync)
 * em vez de tentar interpretar um formato que não entende — melhor um
 * 409 explícito do que corromper dado silenciosamente.
 */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
