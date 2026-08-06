// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Preset base compartilhado por todos os pacotes TypeScript do monorepo.
 * Pacotes específicos (node, react, domain) estendem este.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "out/**", "build/**", ".turbo/**", "node_modules/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
