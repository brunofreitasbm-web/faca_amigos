// @ts-check
import tseslint from "typescript-eslint";
import base from "./base.js";

/**
 * Preset para packages/domain e packages/contracts (D5 do plano de
 * arquitetura): regras de negócio puras, sem Node, sem fetch, sem
 * Date.now() direto. Isso é o que garante que o MESMO código rode no
 * Electron main, no navegador do tablet, no Next.js do back-office e
 * numa Edge Function Deno — sem reescrever a lógica de preço em 4 lugares.
 */
export default tseslint.config(...base, {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["node:*"],
            message:
              "packages/domain e packages/contracts são puros — sem node:*. " +
              "Se precisa de I/O, o código pertence a apps/kiosk/src/main ou a um package de infraestrutura.",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      {
        name: "fetch",
        message: "Domínio puro não faz I/O. Injete os dados via parâmetro.",
      },
      {
        name: "Date",
        message:
          "Não use `new Date()`/`Date.now()` direto — receba o relógio injetado " +
          "(ver packages/domain/src/time/clock.ts) para permitir testes determinísticos " +
          "e para o mesmo motor rodar em Deno/Edge Functions.",
      },
    ],
  },
});
