#!/usr/bin/env node
// Gera a senha do dono para a tela de autorização OAuth do MCP e imprime o SQL que grava o HASH.
// A senha só aparece aqui, uma vez. Uso: node scripts/mcp-set-owner-password.mjs [senha]
// Sem argumento, gera uma senha aleatória. Rode o SQL impresso no Supabase (editor SQL).
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2] ?? randomBytes(15).toString("base64url");
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;

console.log(`Senha do dono (guarde agora): ${password}\n`);
console.log("-- Rode no Supabase:");
console.log(
  `insert into fa_mcp_oauth_config (id, password_hash) values (1, '${hash}')\n  on conflict (id) do update set password_hash = excluded.password_hash, failed_count = 0, locked_until = null;`,
);
