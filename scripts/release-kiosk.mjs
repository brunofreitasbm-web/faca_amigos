// Publica uma nova versão do instalador do kiosk no feed do auto-updater
// (Supabase Storage, bucket público "kiosk-updates").
//
// Fluxo: builda o instalador (pnpm dist:kiosk) -> apaga versões antigas do
// bucket -> sobe os artefatos (.exe, .blockmap, latest.yml).
//
// Requer FACAAMIGOS_SUPABASE_URL e FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY em
// apps/kiosk/.env (mesma credencial já usada pelo print bridge local).
//
// Uso: pnpm release:kiosk
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kioskDir = join(root, "apps", "kiosk");
const releaseDir = join(kioskDir, "release");
const BUCKET = "kiosk-updates";
const PREFIX = "kiosk";

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: cwd ?? root, shell: true });
}

function loadEnv(envPath) {
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const envPath = join(kioskDir, ".env");
if (!existsSync(envPath)) throw new Error(`Não encontrei ${envPath}`);
const env = loadEnv(envPath);
const supabaseUrl = env.FACAAMIGOS_SUPABASE_URL;
// Aceita o nome novo (sb_secret_..., rotacionável sozinho) e mantém o
// antigo funcionando para não quebrar um .env já preenchido.
const serviceRoleKey = env.FACAAMIGOS_SUPABASE_SECRET_KEY || env.FACAAMIGOS_SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("FACAAMIGOS_SUPABASE_URL / FACAAMIGOS_SUPABASE_SECRET_KEY ausentes em apps/kiosk/.env");
}

async function storageFetch(path, options) {
  const res = await fetch(`${supabaseUrl}/storage/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Storage ${options.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

// 1. Build do instalador (workspace + kiosk-ui + ícones + electron-builder)
run("pnpm dist:kiosk");

// 2. Descobre a versão publicada a partir do latest.yml recém-gerado
const latestYmlPath = join(releaseDir, "latest.yml");
if (!existsSync(latestYmlPath)) {
  throw new Error(`latest.yml não encontrado em ${latestYmlPath} — build do electron-builder falhou?`);
}
const latestYmlContent = readFileSync(latestYmlPath, "utf-8");
const version = latestYmlContent.match(/^version:\s*(\S+)/m)?.[1];
if (!version) throw new Error("Não consegui extrair a versão de latest.yml");
console.log(`\nVersão a publicar: ${version}`);

// 3. Remove instaladores de versões antigas do bucket (o electron-updater só
// precisa do mais recente; deixar os antigos só desperdiça espaço).
console.log("\nListando arquivos antigos no bucket...");
const listRes = await storageFetch(`/object/list/${BUCKET}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: `${PREFIX}/`, limit: 100 }),
});
const existing = await listRes.json();
const staleFiles = existing
  .map((f) => f.name)
  .filter((name) => name.endsWith(".exe") || name.endsWith(".exe.blockmap"));
if (staleFiles.length > 0) {
  console.log(`Removendo: ${staleFiles.join(", ")}`);
  await storageFetch(`/object/${BUCKET}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: staleFiles.map((name) => `${PREFIX}/${name}`) }),
  });
}

// 4. Sobe os artefatos novos (x-upsert sobrescreve se já existir)
const uploads = [
  { file: `FacaAmigos-Setup-${version}.exe`, contentType: "application/x-msdownload" },
  { file: `FacaAmigos-Setup-${version}.exe.blockmap`, contentType: "application/octet-stream" },
  { file: "latest.yml", contentType: "text/yaml" },
];
for (const { file, contentType } of uploads) {
  console.log(`Enviando ${file}...`);
  const body = readFileSync(join(releaseDir, file));
  await storageFetch(`/object/${BUCKET}/${PREFIX}/${file}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
}

const feedUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${PREFIX}`;
console.log(`\n✅ Kiosk v${version} publicado em ${feedUrl}/`);
