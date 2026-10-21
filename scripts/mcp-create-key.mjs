#!/usr/bin/env node
// Gera uma chave para o MCP (api/mcp.ts) e grava só o hash em fa_mcp_api_keys.
// A chave aparece UMA vez, na saída. Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/mcp-create-key.mjs "Bruno - Claude" [unit_id,unit_id]
// Sem unit_ids, a chave enxerga todas as unidades.
import { createHash, randomBytes } from "node:crypto";

const [label, units] = process.argv.slice(2);
if (!label) {
  console.error('Uso: node scripts/mcp-create-key.mjs "<rótulo>" [unit_id,unit_id]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const key = `fa_mcp_${randomBytes(32).toString("base64url")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const unitIds = units ? units.split(",").map((s) => s.trim()).filter(Boolean) : null;

const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/fa_mcp_api_keys`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  },
  body: JSON.stringify({ key_hash: keyHash, label, unit_ids: unitIds }),
});
if (!res.ok) {
  console.error("Falha ao gravar a chave:", res.status, await res.text());
  process.exit(1);
}
console.log(`Chave criada para "${label}" (${unitIds ? unitIds.length + " unidade(s)" : "todas as unidades"}).`);
console.log("Guarde agora; ela não pode ser recuperada depois:\n");
console.log(key);
