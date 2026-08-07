import { supabase } from "./client.js";

/**
 * Resiliência a quedas breves de rede (Fase 3): toda chamada transacional
 * (check-in, checkout, ...) carrega uma idempotencyKey. Se a chamada falhar
 * por rede (não por regra de negócio — isso o servidor rejeita na hora), ela
 * fica na fila e é reenviada quando a conexão volta; a função RPC do lado
 * do banco devolve o resultado já processado em vez de duplicar o efeito
 * (ver fa_kiosk_check_idempotency/fa_kiosk_store_idempotency, Fase 0).
 *
 * Usa localStorage em vez de IndexedDB: a fila é sempre pequena (poucas
 * chamadas pendentes por vez, nunca um histórico grande) e localStorage é
 * síncrono e mais simples de auditar — funcionalmente equivalente aqui.
 */

const QUEUE_KEY = "fa_kiosk_offline_queue";

interface PendingCall {
  idempotencyKey: string;
  rpcName: string;
  args: Record<string, unknown>;
  queuedAtMs: number;
}

export class OfflineQueuedError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super("Sem conexão — a operação foi salva e será concluída assim que a rede voltar.");
  }
}

function readQueue(): PendingCall[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as PendingCall[];
  } catch {
    return [];
  }
}

function writeQueue(items: PendingCall[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function isNetworkError(error: unknown): boolean {
  // supabase-js/postgrest lança TypeError ("Failed to fetch") quando não
  // consegue nem abrir a conexão — diferente de um erro vindo do servidor
  // (RAISE EXCEPTION), que chega como PostgrestError com `code`/`message`.
  return error instanceof TypeError;
}

/** Chama uma função RPC transacional com fila de reenvio em caso de queda de rede. */
export async function callResilient<T>(rpcName: string, args: Record<string, unknown>): Promise<T> {
  const idempotencyKey = crypto.randomUUID();
  const fullArgs = { p_idempotency_key: idempotencyKey, ...args };
  try {
    const { data, error } = await supabase().rpc(rpcName, fullArgs);
    if (error) {
      console.warn(`[RPC ${rpcName} Error]`, error);
      const msg = error.message || error.details || "Erro no servidor (RPC)";
      throw new Error(msg);
    }
    return data as T;
  } catch (err) {
    if (isNetworkError(err)) {
      writeQueue([...readQueue(), { idempotencyKey, rpcName, args, queuedAtMs: Date.now() }]);
      throw new OfflineQueuedError(idempotencyKey);
    }
    throw err;
  }
}

export function pendingCount(): number {
  return readQueue().length;
}

/** Tenta reenviar a fila; chame ao reconectar (`window.addEventListener("online", ...)`) ou periodicamente. */
export async function flushOfflineQueue(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  const remaining: PendingCall[] = [];
  for (const call of queue) {
    try {
      const { error } = await supabase().rpc(call.rpcName, { p_idempotency_key: call.idempotencyKey, ...call.args });
      if (error) throw error;
    } catch (err) {
      if (isNetworkError(err)) {
        remaining.push(call);
        continue;
      }
      // Erro de regra de negócio (ex.: cupom esgotado nesse meio tempo) —
      // não adianta reenviar, mas também não trava a fila inteira.
    }
  }
  writeQueue(remaining);
}
