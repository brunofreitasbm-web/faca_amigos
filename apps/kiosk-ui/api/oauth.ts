import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServiceClient } from "./_shopping/common.js";
import { getBaseUrl } from "./_mcp/oauth.js";
import { handleOAuth } from "./_mcp/oauthFlow.js";
import { createOAuthStore } from "./_mcp/oauthStore.js";

/**
 * OAuth 2.1 do MCP. As rotas públicas (/oauth/*, /.well-known/*) chegam aqui por
 * rewrite no vercel.json, com ?action=metadata|resource|register|authorize|token.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? v[0] : v;

  const raw = req.body;
  const body: Record<string, unknown> = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  try {
    const out = await handleOAuth(
      { method: req.method ?? "GET", action: query.action ?? "", query, body },
      createOAuthStore(createServiceClient()),
      getBaseUrl(),
    );
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    return res.status(out.status).send(out.body);
  } catch {
    return res.status(500).json({ error: "server_error", error_description: "Erro interno." });
  }
}
