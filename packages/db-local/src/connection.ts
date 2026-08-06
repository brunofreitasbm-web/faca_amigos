import type * as NodeSqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

// `process.getBuiltinModule` (em vez de `import ... from "node:sqlite"`)
// contorna um bug de resolução do Vite/Vitest: o bundler ainda não
// conhece node:sqlite (experimental, Node 22.5+) na sua lista interna
// de built-ins e tenta resolvê-lo como pacote npm "sqlite", que não
// existe. Chamada em runtime não passa pelo resolver estático do Vite.
const { DatabaseSync: DatabaseSyncCtor } = process.getBuiltinModule("node:sqlite") as typeof NodeSqlite;

export type Db = DatabaseSync;

/**
 * Abre a conexão local (D2: única gravadora do ponto).
 *
 * Usa `node:sqlite` (nativo do runtime) em vez de `better-sqlite3`:
 * evita de propósito o risco #1 do plano de arquitetura ("módulos
 * nativos × ABI do Electron × pnpm — trava o empacotamento"). Sem
 * binário pré-compilado a buscar e sem node-gyp/Visual Studio Build
 * Tools no caminho — o que já se provou um bloqueio real nesta
 * máquina de desenvolvimento (Node 24 ainda não tem prebuild do
 * better-sqlite3, e não há VS Build Tools instalado). `node:sqlite` é
 * experimental no Node 22/24, mas cobre o que a Fase 1 precisa; se
 * faltar recurso (ex.: SQLCipher — D7), revisitar então.
 *
 * Cifra (D7) segue como débito técnico explícito: por ora o arquivo
 * .db é gravado em claro. Mitigação intermediária até lá: BitLocker.
 */
export function openDatabase(filePath: string): Db {
  const db = new DatabaseSyncCtor(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** node:sqlite não expõe `db.transaction()` como o better-sqlite3 — helper equivalente com ROLLBACK em caso de erro. */
export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
