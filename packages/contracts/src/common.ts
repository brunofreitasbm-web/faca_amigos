import { z } from "zod";

/**
 * Campos presentes em toda tabela sincronizável (seção 4.1 do plano de
 * arquitetura): UUID v7 gerado no cliente, rev para LWW, timestamps em
 * epoch ms UTC, dispositivo de origem, tombstone e business_date.
 */
export const uuidV7 = z.string().uuid();

export const epochMs = z.number().int().nonnegative();

/** Dia operacional YYYY-MM-DD, com cutoff configurável (padrão 04:00 America/Belem). */
export const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const centavos = z.number().int();

export const syncEnvelopeBase = z.object({
  id: uuidV7,
  tenantId: uuidV7,
  unitId: uuidV7,
  rev: z.number().int().nonnegative(),
  createdAtMs: epochMs,
  updatedAtMs: epochMs,
  originDeviceId: uuidV7,
  deletedAtMs: epochMs.nullable().default(null),
  businessDate,
});

export type SyncEnvelopeBase = z.infer<typeof syncEnvelopeBase>;
