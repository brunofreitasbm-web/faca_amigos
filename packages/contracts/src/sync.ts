import { z } from "zod";
import { PROTOCOL_VERSION } from "./protocol-version.js";
import { uuidV7 } from "./common.js";

/**
 * Envelope de sincronização (seção 5.3 do plano). Um trigger SQLite
 * genérico grava em sync_outbox na MESMA transação da escrita de
 * negócio — o outbox-pump apenas lê e envia lotes ≤200 mudanças em
 * ordem topológica (guardians → children → sessions → orders → itens
 * → pagamentos).
 */
export const syncChangeSchema = z.object({
  table: z.string(),
  rowId: uuidV7,
  op: z.enum(["INSERT", "UPDATE", "DELETE"]),
  rev: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export const syncEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: uuidV7,
  unitId: uuidV7,
  localTxnId: uuidV7, // agrupa mutações atômicas de uma mesma transação local
  clientSentAtMs: z.number().int().nonnegative(),
  changes: z.array(syncChangeSchema).min(1).max(200),
  idempotencyKey: z.string(), // sha256(deviceId|localTxnId)
});
export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;

export const syncPushResponseSchema = z.object({
  idempotencyKey: z.string(),
  applied: z.number().int().nonnegative(),
  rejected: z.array(z.object({ rowId: uuidV7, reason: z.string() })),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
