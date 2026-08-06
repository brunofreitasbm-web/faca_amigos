// @ts-check
import base from "@facaamigos/config/eslint-base";

// db-local é infraestrutura (I/O de disco), não domínio puro — usa o
// preset base, não o domain.js que bloqueia node:* e Date.
export default base;
