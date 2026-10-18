#!/usr/bin/env node
// Cria um cliente OAuth confidencial para o MCP (ex.: Gemini "Apps conectados personalizados").
// ID e segredo aparecem só aqui, uma vez; no banco vai o SHA-256 do segredo. Uso:
//   node scripts/mcp-create-oauth-client.mjs "Gemini" "https://oauth-redirect.googleusercontent.com/r/..."
// Rode o SQL impresso no Supabase.
import { createHash, randomBytes } from "node:crypto";

const [name, redirect] = process.argv.slice(2);
if (!name || !redirect) {
  console.error('Uso: node scripts/mcp-create-oauth-client.mjs "<nome>" "<redirect_uri https>"');
  process.exit(1);
}
const u = new URL(redirect);
if (u.protocol !== "https:" || u.hash || u.username || u.password) {
  console.error("redirect_uri precisa ser https, sem fragmento nem credenciais.");
  process.exit(1);
}
const esc = (s) => s.replace(/'/g, "''");
const clientId = `fa_cli_${randomBytes(16).toString("base64url")}`;
const secret = `fa_cs_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(secret).digest("hex");

console.log(`ID do cliente:      ${clientId}`);
console.log(`Chave secreta:      ${secret}   (guarde agora; não dá para recuperar)\n`);
console.log("-- Rode no Supabase:");
console.log(
  `insert into fa_mcp_oauth_clients (client_id, client_name, redirect_uris, client_secret_hash)\n  values ('${clientId}', '${esc(name)}', array['${esc(redirect)}'], '${hash}');`,
);
