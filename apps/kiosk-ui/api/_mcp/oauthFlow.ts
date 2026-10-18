import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  LOCK_MINUTES,
  MAX_CLIENTS,
  MAX_FAILED_ATTEMPTS,
  REFRESH_TTL_S,
  authorizationServerMetadata,
  isValidChallenge,
  isValidRedirectUri,
  protectedResourceMetadata,
  randomToken,
  renderConsentPage,
  sha256,
  verifyPassword,
  verifyPkce,
  type ConsentParams,
} from "./oauth.js";

export interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}
export interface CodeRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
}
export interface TokenInsert {
  client_id: string;
  access_hash: string;
  refresh_hash: string;
  access_expires_at: string;
  refresh_expires_at: string;
}
export interface ConfigRow {
  password_hash: string;
  failed_count: number;
  locked_until: string | null;
}

/** Acesso ao banco; a implementação real está em oauthStore.ts. */
export interface OAuthStore {
  countClients(): Promise<number>;
  insertClient(c: ClientRow): Promise<void>;
  getClient(id: string): Promise<ClientRow | null>;
  insertCode(c: CodeRow & { code_hash: string }): Promise<void>;
  /** Apaga e devolve o código numa só operação: uso único. */
  takeCode(codeHash: string): Promise<CodeRow | null>;
  insertToken(t: TokenInsert): Promise<void>;
  /**
   * Troca os hashes de um refresh token válido do cliente informado, numa só operação.
   * false se inexistente, de outro cliente, expirado ou revogado.
   */
  rotateToken(oldRefreshHash: string, clientId: string, next: TokenInsert, nowIso: string): Promise<boolean>;
  getConfig(): Promise<ConfigRow | null>;
  setAttempts(failedCount: number, lockedUntil: string | null): Promise<void>;
}

export interface OAuthReq {
  method: string;
  action: string;
  query: Record<string, string | undefined>;
  body: Record<string, unknown>;
}
export interface OAuthRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const HTML_SECURITY = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http:",
  "Referrer-Policy": "no-referrer",
  ...NO_STORE,
};

const json = (status: number, data: unknown, extra: Record<string, string> = {}): OAuthRes => ({
  status,
  headers: { "Content-Type": "application/json", ...CORS, ...NO_STORE, ...extra },
  body: JSON.stringify(data),
});
const oauthError = (status: number, error: string, description: string): OAuthRes =>
  json(status, { error, error_description: description });
const htmlError = (status: number, message: string): OAuthRes => ({
  status,
  headers: HTML_SECURITY,
  body: `<!doctype html><meta charset="utf-8"><title>Erro</title><p style="font-family:system-ui;margin:2rem">${message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</p>`,
});

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function redirectWith(uri: string, params: Record<string, string>): OAuthRes {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return { status: 302, headers: { Location: u.toString(), ...NO_STORE }, body: "" };
}

export async function handleOAuth(req: OAuthReq, store: OAuthStore, base: string, now: Date = new Date()): Promise<OAuthRes> {
  if (req.method === "OPTIONS") return { status: 204, headers: CORS, body: "" };

  switch (req.action) {
    case "metadata":
      return json(200, authorizationServerMetadata(base), { "Cache-Control": "public, max-age=300" });
    case "resource":
      return json(200, protectedResourceMetadata(base), { "Cache-Control": "public, max-age=300" });
    case "register":
      return req.method === "POST" ? register(req, store) : oauthError(405, "invalid_request", "Use POST.");
    case "authorize":
      return authorize(req, store, now);
    case "token":
      return req.method === "POST" ? token(req, store, now) : oauthError(405, "invalid_request", "Use POST.");
    default:
      return oauthError(404, "invalid_request", "Rota desconhecida.");
  }
}

async function register(req: OAuthReq, store: OAuthStore): Promise<OAuthRes> {
  const uris = req.body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === "string" && isValidRedirectUri(u))) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris deve ter de 1 a 5 URLs https (ou http em localhost).");
  }
  if ((await store.countClients()) >= MAX_CLIENTS) {
    return oauthError(429, "temporarily_unavailable", "Limite de clientes registrados atingido.");
  }
  const client_name = (str(req.body.client_name) || "Cliente MCP").slice(0, 100);
  const client_id = randomToken("fa_cli_", 16);
  await store.insertClient({ client_id, client_name, redirect_uris: uris as string[] });
  return json(201, {
    client_id,
    client_name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  });
}

async function authorize(req: OAuthReq, store: OAuthStore, now: Date): Promise<OAuthRes> {
  const src = req.method === "POST" ? req.body : req.query;
  const p: ConsentParams = {
    response_type: str(src.response_type),
    client_id: str(src.client_id),
    redirect_uri: str(src.redirect_uri),
    code_challenge: str(src.code_challenge),
    code_challenge_method: str(src.code_challenge_method),
    state: str(src.state),
    scope: str(src.scope),
  };

  // Cliente ou redirect_uri inválidos: nunca redirecionar (evita open redirect).
  const client = p.client_id ? await store.getClient(p.client_id) : null;
  if (!client) return htmlError(400, "Cliente desconhecido.");
  if (!client.redirect_uris.includes(p.redirect_uri)) return htmlError(400, "redirect_uri não registrado para este cliente.");

  if (p.response_type !== "code") return redirectWith(p.redirect_uri, { error: "unsupported_response_type", state: p.state });
  if (p.code_challenge_method !== "S256" || !isValidChallenge(p.code_challenge)) {
    return redirectWith(p.redirect_uri, { error: "invalid_request", error_description: "PKCE S256 obrigatório.", state: p.state });
  }

  const page = (error?: string, status = 200): OAuthRes => ({
    status,
    headers: HTML_SECURITY,
    body: renderConsentPage({ clientName: client.client_name, params: p, error }),
  });

  if (req.method !== "POST") return page();

  const cfg = await store.getConfig();
  if (!cfg) return htmlError(503, "Senha do dono ainda não configurada.");
  if (cfg.locked_until && new Date(cfg.locked_until) > now) {
    return page("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429);
  }
  if (!verifyPassword(str(req.body.password), cfg.password_hash)) {
    const failed = cfg.failed_count + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      await store.setAttempts(0, new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString());
    } else {
      await store.setAttempts(failed, null);
    }
    return page("Senha incorreta.", 401);
  }
  if (cfg.failed_count !== 0 || cfg.locked_until) await store.setAttempts(0, null);

  const code = randomToken("fa_code_");
  await store.insertCode({
    code_hash: sha256(code),
    client_id: client.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    expires_at: new Date(now.getTime() + CODE_TTL_S * 1000).toISOString(),
  });
  return redirectWith(p.redirect_uri, { code, state: p.state });
}

async function token(req: OAuthReq, store: OAuthStore, now: Date): Promise<OAuthRes> {
  const grant = str(req.body.grant_type);
  const issue = (client_id: string) => {
    const access = randomToken("fa_oat_");
    const refresh = randomToken("fa_ort_");
    const row: TokenInsert = {
      client_id,
      access_hash: sha256(access),
      refresh_hash: sha256(refresh),
      access_expires_at: new Date(now.getTime() + ACCESS_TTL_S * 1000).toISOString(),
      refresh_expires_at: new Date(now.getTime() + REFRESH_TTL_S * 1000).toISOString(),
    };
    return { access, refresh, row };
  };
  const response = (access: string, refresh: string) =>
    json(200, { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: "mcp:read" });

  if (grant === "authorization_code") {
    const code = str(req.body.code);
    const row = code ? await store.takeCode(sha256(code)) : null;
    if (!row || new Date(row.expires_at) <= now) return oauthError(400, "invalid_grant", "Código inválido ou expirado.");
    if (row.client_id !== str(req.body.client_id) || row.redirect_uri !== str(req.body.redirect_uri)) {
      return oauthError(400, "invalid_grant", "client_id ou redirect_uri não conferem.");
    }
    if (!verifyPkce(str(req.body.code_verifier), row.code_challenge)) {
      return oauthError(400, "invalid_grant", "code_verifier não confere.");
    }
    const t = issue(row.client_id);
    await store.insertToken(t.row);
    return response(t.access, t.refresh);
  }

  if (grant === "refresh_token") {
    const refresh = str(req.body.refresh_token);
    if (!refresh) return oauthError(400, "invalid_request", "refresh_token ausente.");
    const clientId = str(req.body.client_id);
    const t = issue(clientId);
    const rotated = clientId ? await store.rotateToken(sha256(refresh), clientId, t.row, now.toISOString()) : false;
    if (!rotated) {
      return oauthError(400, "invalid_grant", "refresh_token inválido, expirado ou revogado.");
    }
    return response(t.access, t.refresh);
  }

  return oauthError(400, "unsupported_grant_type", "Use authorization_code ou refresh_token.");
}
