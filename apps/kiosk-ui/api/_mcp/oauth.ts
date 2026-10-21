import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const CODE_TTL_S = 300;
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 24 * 3600;
export const MAX_CLIENTS = 500;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const randomToken = (prefix: string, bytes = 32): string => `${prefix}${randomBytes(bytes).toString("base64url")}`;

export function getBaseUrl(): string {
  return (process.env.MCP_PUBLIC_URL ?? "https://app.institutofacaamigos.com.br").replace(/\/$/, "");
}

// ── senha do dono ──────────────────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── segredo de cliente confidencial (alta entropia: SHA-256 basta) ──────────
export function verifyClientSecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── PKCE e redirect_uri ────────────────────────────────────────────────────
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed.length === challenge.length && timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

export const isValidChallenge = (c: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(c);

/** https em qualquer host; http só em loopback (clientes de linha de comando). */
export function isValidRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password || !u.hostname) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

// ── metadados (RFC 8414 e RFC 9728) ────────────────────────────────────────
export const authorizationServerMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  scopes_supported: ["mcp:read"],
});

export const protectedResourceMetadata = (base: string) => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  scopes_supported: ["mcp:read"],
  bearer_methods_supported: ["header"],
});

// ── página de consentimento ────────────────────────────────────────────────
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface ConsentParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
}

export function renderConsentPage(opts: { clientName: string; params: ConsentParams; error?: string }): string {
  const host = new URL(opts.params.redirect_uri).host;
  const hidden = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Autorizar acesso</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f8;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;max-width:380px;margin:16px;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0002}h1{font-size:1.2rem;margin:0 0 12px}p{color:#444;line-height:1.45}.host{font-weight:700;word-break:break-all}input[type=password]{width:100%;box-sizing:border-box;padding:10px;font-size:1rem;margin:8px 0 12px;border:1px solid #999;border-radius:8px}button{width:100%;padding:11px;font-size:1rem;border:0;border-radius:8px;background:#2ecfb5;color:#06332b;font-weight:700;cursor:pointer}.err{color:#b00020;font-weight:600}</style></head>
<body><main><h1>Autorizar acesso aos dados do FaçaAmigos</h1>
<p><b>${escapeHtml(opts.clientName)}</b> quer ler dados agregados (faturamento, sessões, caixa, NPS). Nada é alterado.</p>
<p>Depois de autorizar, você será enviado para: <span class="host">${escapeHtml(host)}</span>. Se não reconhece esse endereço, feche esta página.</p>
${opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : ""}
<form method="post" action="/oauth/authorize">${hidden}<label for="p">Senha do dono</label><input id="p" type="password" name="password" autocomplete="current-password" autofocus required><button type="submit">Autorizar</button></form></main></body></html>`;
}
