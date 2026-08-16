import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTransaction, type Db } from "./connection.js";

// No app Electron empacotado o bundle esbuild muda o import.meta.url e os
// .sql viajam como extraResources — o caminho real chega por env var. A
// env var só é setada dentro de startLocalServer() em main.ts, que roda
// depois do import deste módulo — por isso o caminho é resolvido em uma
// função (lazy) e não em uma const de topo de módulo, senão o fallback
// (bundle/migrations dentro do app.asar) sempre "vence" e o ENOENT estoura.
function resolveMigrationsDir(): string {
  return process.env.FACAAMIGOS_MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "migrations");
}

/**
 * Aplica em ordem os arquivos .sql de `migrations/` ainda não
 * registrados em `schema_migrations`. Cada arquivo roda em uma única
 * transação — ou aplica inteiro, ou não aplica nada.
 */
export function migrate(db: Db): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    );
  `);

  const already = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name));

  const migrationsDir = resolveMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const markApplied = db.prepare("INSERT INTO schema_migrations (name, applied_at_ms) VALUES (?, ?)");

  for (const file of files) {
    if (already.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    withTransaction(db, () => {
      db.exec(sql);
      markApplied.run(file, Date.now());
    });
    applied.push(file);
  }

  return { applied };
}
