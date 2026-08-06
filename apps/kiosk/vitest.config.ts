// @ts-check
import { defineConfig } from "vitest/config";

// Vite/Vitest ainda não reconhece node:sqlite (experimental, Node
// 22.5+) na lista interna de módulos nativos e tenta resolvê-lo como
// pacote npm "sqlite" — que não existe. Forçar como external evita
// que o bundler mexa no specifier.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    restoreMocks: true,
    server: { deps: { external: ["node:sqlite", "sqlite"] } },
  },
  ssr: { external: ["node:sqlite", "sqlite"] },
});
