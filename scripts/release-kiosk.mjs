// Publica uma nova versão do instalador do kiosk no feed do auto-updater
// (Vercel, projeto "facaamigos-updates", domínio update.institutofacaamigos.com.br).
//
// Fluxo: builda o instalador (pnpm dist:kiosk) -> copia os artefatos
// (.exe, .blockmap, latest.yml) para a pasta do feed -> deploy via Vercel CLI.
//
// Uso: pnpm release:kiosk
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const kioskDir = join(root, "apps", "kiosk");
const releaseDir = join(kioskDir, "release");
const feedDir = join(root, "apps", "kiosk", "update-feed");
const feedKioskDir = join(feedDir, "kiosk");

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: cwd ?? root, shell: true });
}

// 1. Build do instalador (workspace + kiosk-ui + ícones + electron-builder)
run("pnpm dist:kiosk");

// 2. Descobre a versão publicada a partir do latest.yml recém-gerado
const latestYmlPath = join(releaseDir, "latest.yml");
if (!existsSync(latestYmlPath)) {
  throw new Error(`latest.yml não encontrado em ${latestYmlPath} — build do electron-builder falhou?`);
}
const latestYml = readFileSync(latestYmlPath, "utf-8");
const version = latestYml.match(/^version:\s*(\S+)/m)?.[1];
if (!version) throw new Error("Não consegui extrair a versão de latest.yml");
console.log(`\nVersão a publicar: ${version}`);

// 3. Monta a pasta do feed estático (o que o Vercel vai servir em /kiosk/*)
mkdirSync(feedKioskDir, { recursive: true });
for (const file of [`FacaAmigos-Setup-${version}.exe`, `FacaAmigos-Setup-${version}.exe.blockmap`, "latest.yml"]) {
  copyFileSync(join(releaseDir, file), join(feedKioskDir, file));
}

const vercelJsonPath = join(feedDir, "vercel.json");
if (!existsSync(vercelJsonPath)) {
  writeFileSync(
    vercelJsonPath,
    JSON.stringify(
      {
        headers: [
          { source: "/kiosk/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] },
          // Regra mais específica por último: no cache do CDN sobrescreve o wildcard acima
          // (Vercel aplica headers na ordem, a última regra que casar vence em conflito).
          { source: "/kiosk/latest.yml", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

// 4. Deploy via Vercel CLI (precisa estar logado: `npx vercel login`)
run("npx vercel link --yes --project facaamigos-updates", feedDir);
run("npx vercel --prod --yes", feedDir);

console.log(`\n✅ Kiosk v${version} publicado em https://update.institutofacaamigos.com.br/kiosk/`);
