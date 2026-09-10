// Incrementa o patch da versão do kiosk (apps/kiosk/package.json) e imprime
// a nova versão em stdout. Usado pelo CI (build-kiosk.yml) para que todo
// push relevante gere uma versão nova de verdade — sem isso, dist:kiosk +
// release:kiosk publicam um instalador que o electron-updater ignora, porque
// a versão já é a que os terminais têm.
//
// Uso: node scripts/bump-kiosk-version.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = join(root, "apps", "kiosk", "package.json");
const raw = readFileSync(pkgPath, "utf-8");
const pkg = JSON.parse(raw);

const partes = pkg.version.split(".").map(Number);
if (partes.length !== 3 || partes.some(Number.isNaN)) {
  throw new Error(`Versão atual "${pkg.version}" não é semver simples (major.minor.patch).`);
}
const [major, minor, patch] = partes;
pkg.version = `${major}.${minor}.${patch + 1}`;

// Preserva o formato original (2 espaços + quebra de linha final), igual ao
// que já está no arquivo, para o diff do commit de bump ficar só na versão.
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(pkg.version);
