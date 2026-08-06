import { randomBytes } from "node:crypto";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "./app.js";
import { seedDevData } from "./seed-dev.js";
import { loadOrCreateTls } from "./tls.js";

const DB_PATH = process.env.FACAAMIGOS_DB_PATH ?? "./dev.db";
const PORT = Number(process.env.FACAAMIGOS_PORT ?? 7317);
const TLS_ENABLED = process.env.FACAAMIGOS_TLS === "true";

async function main() {
  const db = openDatabase(DB_PATH);
  const { applied } = migrate(db);
  if (applied.length > 0) console.log(`Migrations aplicadas: ${applied.join(", ")}`);

  const nowMs = Date.now();
  if (process.env.FACAAMIGOS_SEED_DEV !== "false") seedDevData(db, nowMs);

  // Chave HMAC efêmera (troca a cada reinício do servidor) — aceitável
  // enquanto o pareamento por QR ainda não está ligado (ver security/codes.ts).
  // Antes de imprimir pulseiras de verdade, isto precisa ser persistido
  // por unidade em app_settings, não gerado em memória.
  const hmacKey = randomBytes(32).toString("hex");

  const tls = TLS_ENABLED ? loadOrCreateTls("./.certs") : undefined;
  const app = await buildApp({ db, hmacKey, nowMs: () => Date.now() }, { tls });
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`FaçaAmigos kiosk server em ${tls ? "https" : "http"}://127.0.0.1:${PORT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
