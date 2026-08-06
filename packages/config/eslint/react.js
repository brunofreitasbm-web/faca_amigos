// @ts-check
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import base from "./base.js";

export default tseslint.config(...base, {
  plugins: { "react-hooks": reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
  },
});
