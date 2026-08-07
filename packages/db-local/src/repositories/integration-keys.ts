import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

/**
 * Chaves de acesso entregues a terceiros e trilha de uso delas
 * (migration 0005). O hash é calculado fora daqui — este arquivo não
 * conhece criptografia, só guarda e busca, do mesmo jeito que
 * `local_credentials` faz com o PIN.
 */

export type IntegrationScope = "FATURAMENTO_LEITURA";

export interface IntegrationApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scope: IntegrationScope;
  unit_id: string | null;
  created_at_ms: number;
  created_by_employee_id: string | null;
  last_used_at_ms: number | null;
  revoked_at_ms: number | null;
}

export function insertIntegrationApiKey(
  db: Db,
  key: {
    id: string;
    name: string;
    prefix: string;
    keyHash: string;
    scope: IntegrationScope;
    unitId: string | null;
    createdByEmployeeId: string | null;
  },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO integration_api_keys
       (id, name, prefix, key_hash, scope, unit_id, created_at_ms, created_by_employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    key.id,
    key.name,
    key.prefix,
    key.keyHash,
    key.scope,
    key.unitId,
    nowMs,
    key.createdByEmployeeId,
  );
}

/** Busca pelo prefixo público. O segredo é conferido pelo chamador contra `key_hash`. */
export function findIntegrationApiKeyByPrefix(
  db: Db,
  prefix: string,
): IntegrationApiKeyRow | undefined {
  return db
    .prepare("SELECT * FROM integration_api_keys WHERE prefix = ?")
    .get(prefix) as unknown as IntegrationApiKeyRow | undefined;
}

export interface IntegrationApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scope: IntegrationScope;
  unit_id: string | null;
  created_at_ms: number;
  last_used_at_ms: number | null;
  revoked_at_ms: number | null;
}

/** Listagem para o painel. Nunca devolve `key_hash` — nem o hash precisa circular pela UI. */
export function listIntegrationApiKeys(db: Db): IntegrationApiKeySummary[] {
  return db
    .prepare(
      `SELECT id, name, prefix, scope, unit_id, created_at_ms, last_used_at_ms, revoked_at_ms
       FROM integration_api_keys ORDER BY created_at_ms DESC`,
    )
    .all() as unknown as IntegrationApiKeySummary[];
}

/** Revogação é marcação, não DELETE: o log de acesso continua referenciando a chave. */
export function revokeIntegrationApiKey(db: Db, id: string, nowMs: number): void {
  db.prepare(
    "UPDATE integration_api_keys SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL",
  ).run(nowMs, id);
}

export function touchIntegrationApiKey(db: Db, id: string, nowMs: number): void {
  db.prepare("UPDATE integration_api_keys SET last_used_at_ms = ? WHERE id = ?").run(nowMs, id);
}

export function logIntegrationAccess(
  db: Db,
  entry: {
    apiKeyId: string | null;
    route: string;
    query: string | null;
    status: number;
    remoteIp: string | null;
  },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO integration_access_log (id, api_key_id, at_ms, route, query, status, remote_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv7(nowMs),
    entry.apiKeyId,
    nowMs,
    entry.route,
    entry.query,
    entry.status,
    entry.remoteIp,
  );
}

export interface IntegrationAccessLogRow {
  id: string;
  api_key_id: string | null;
  at_ms: number;
  route: string;
  query: string | null;
  status: number;
  remote_ip: string | null;
}

export function listIntegrationAccessLog(db: Db, limit = 100): IntegrationAccessLogRow[] {
  return db
    .prepare("SELECT * FROM integration_access_log ORDER BY at_ms DESC LIMIT ?")
    .all(limit) as unknown as IntegrationAccessLogRow[];
}
