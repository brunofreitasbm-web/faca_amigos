import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServiceClient } from "./_shopping/common.js";
import { authenticateMcpRequest } from "./_mcp/auth.js";
import { registerTools } from "./_mcp/tools.js";
import { getBaseUrl } from "./_mcp/oauth.js";

/**
 * Servidor MCP somente-leitura (Streamable HTTP, stateless).
 * Acesso: Authorization: Bearer <chave> (ver scripts/mcp-create-key.mjs e docs/MCP.md).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Método não permitido (servidor MCP stateless: use POST)." },
      id: null,
    });
  }

  const supabase = createServiceClient();
  const auth = await authenticateMcpRequest(supabase, req.headers);
  if (!auth.ok) {
    // Anuncia o servidor de autorização (RFC 9728) para clientes que usam OAuth.
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${getBaseUrl()}/.well-known/oauth-protected-resource"`);
    return res.status(auth.status).json({ error: auth.error });
  }

  const server = new McpServer({ name: "facaamigos", version: "1.0.0" });
  registerTools(server, supabase, auth.scope);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno." }, id: null });
    }
  }
}
