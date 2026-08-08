// Empacota o processo main do Electron em dois arquivos autocontidos —
// nada de node_modules no instalador (zero deps nativas; node:sqlite é
// builtin). Ver plano de distribuição e docs/adr/0002-pnpm-hoisted.md.
import { build } from "esbuild";

// Fastify/avvio usam require() dinâmico em alguns pontos internos — num
// bundle ESM isso precisa do createRequire injetado no topo.
const esmBanner = "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

await build({
  entryPoints: ["src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "bundle/main.mjs",
  external: ["electron"],
  banner: { js: esmBanner },
  logLevel: "info",
});

// Preload em CJS: carrega em qualquer configuração de sandbox do Electron.
await build({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "bundle/preload.js",
  external: ["electron"],
  logLevel: "info",
});
