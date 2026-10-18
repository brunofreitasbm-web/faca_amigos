import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServiceClient } from "./_shopping/common.js";
import { getBaseUrl } from "./_mcp/oauth.js";
import { handleOAuth } from "./_mcp/oauthFlow.js";
import { createOAuthStore } from "./_mcp/oauthStore.js";

/** Rastro para diagnóstico: nunca registra senha, segredo, código nem token. */
function logOAuth(action: string, method: string, query: Record<string, string | undefined>, body: Record<string, unknown>, status: number, out: string): void {
  let error: string | undefined;
  if (status >= 400) {
    try {
      error = (JSON.parse(out) as { error?: string }).error;
    } catch {
      /* corpo HTML */
    }
  }
  const redirect = typeof body.redirect_uri === "string" ? body.redirect_uri : query.redirect_uri;
  // eslint-disable-next-line no-console -- único jeito de deixar rastro nos logs da Vercel
  console.log(
    JSON.stringify({
      oauth: action,
      method,
      status,
      error,
      grant: typeof body.grant_type === "string" ? body.grant_type : undefined,
      client_id: (typeof body.client_id === "string" ? body.client_id : query.client_id)?.slice(0, 24),
      redirect_uri: redirect?.slice(0, 200),
      redirect_uris: action === "register" ? body.redirect_uris : undefined,
      auth_method: action === "register" ? body.token_endpoint_auth_method : undefined,
    }),
  );
}

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
      {
        method: req.method ?? "GET",
        action: query.action ?? "",
        query,
        body,
        headers: { authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined },
      },
      createOAuthStore(createServiceClient()),
      getBaseUrl(),
    );
    logOAuth(query.action ?? "", req.method ?? "GET", query, body, out.status, out.body);
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    return res.status(out.status).send(out.body);
  } catch {
    return res.status(500).json({ error: "server_error", error_description: "Erro interno." });
  }
}
