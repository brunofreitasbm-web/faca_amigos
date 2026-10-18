import { beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { handleOAuth, type ClientRow, type CodeRow, type ConfigRow, type OAuthStore, type TokenInsert } from "../api/_mcp/oauthFlow";
import { hashPassword, isValidRedirectUri, sha256, verifyPassword, verifyPkce } from "../api/_mcp/oauth";
import { authenticateMcpRequest } from "../api/_mcp/auth";

const BASE = "https://app.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const NOW = new Date("2026-10-18T12:00:00Z");

function memoryStore(password = "senha-do-dono") {
  const clients = new Map<string, ClientRow>();
  const codes = new Map<string, CodeRow>();
  const tokens: (TokenInsert & { revoked_at?: string | null })[] = [];
  let config: ConfigRow | null = { password_hash: hashPassword(password), failed_count: 0, locked_until: null };
  const store: OAuthStore = {
    countClients: async () => clients.size,
    insertClient: async (c) => void clients.set(c.client_id, c),
    getClient: async (id) => clients.get(id) ?? null,
    insertCode: async ({ code_hash, ...row }) => void codes.set(code_hash, row),
    takeCode: async (h) => {
      const r = codes.get(h) ?? null;
      codes.delete(h);
      return r;
    },
    insertToken: async (t) => void tokens.push(t),
    rotateToken: async (old, clientId, next, nowIso) => {
      const t = tokens.find((x) => x.refresh_hash === old && x.client_id === clientId && !x.revoked_at && x.refresh_expires_at > nowIso);
      if (!t) return false;
      Object.assign(t, { access_hash: next.access_hash, refresh_hash: next.refresh_hash, access_expires_at: next.access_expires_at, refresh_expires_at: next.refresh_expires_at });
      return true;
    },
    getConfig: async () => config,
    setAttempts: async (failed_count, locked_until) => {
      if (config) config = { ...config, failed_count, locked_until };
    },
  };
  return { store, tokens, clients, getConfig: () => config, dropConfig: () => (config = null) };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const call = (store: OAuthStore, action: string, method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}, now = NOW, headers: Record<string, string> = {}) =>
  handleOAuth({ method, action, query, body, headers }, store, BASE, now);

async function registerClient(store: OAuthStore, redirect = REDIRECT) {
  const r = await call(store, "register", "POST", { client_name: "Claude", redirect_uris: [redirect] });
  return { res: r, client_id: r.status === 201 ? JSON.parse(r.body).client_id : "" };
}

async function authorizeCode(store: OAuthStore, client_id: string, challenge: string, password = "senha-do-dono", now = NOW) {
  return call(store, "authorize", "POST", {
    response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "mcp:read", password,
  }, {}, now);
}
const codeFrom = (location: string) => new URL(location).searchParams.get("code") ?? "";

describe("helpers", () => {
  it("scrypt: aceita a senha certa e recusa a errada", () => {
    const h = hashPassword("abc");
    expect(verifyPassword("abc", h)).toBe(true);
    expect(verifyPassword("abd", h)).toBe(false);
    expect(verifyPassword("abc", "lixo")).toBe(false);
  });
  it("redirect_uri: https e loopback sim; resto não", () => {
    for (const ok of ["https://claude.ai/cb", "http://localhost:8080/cb", "http://127.0.0.1/cb"]) expect(isValidRedirectUri(ok)).toBe(true);
    for (const bad of ["http://evil.com/cb", "javascript:alert(1)", "https://x.com/cb#frag", "https://u:p@x.com/", "nao-e-url"]) expect(isValidRedirectUri(bad)).toBe(false);
  });
  it("PKCE: confere o verifier e recusa verifier curto", () => {
    const { verifier, challenge } = pkce();
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("curto", challenge)).toBe(false);
    expect(verifyPkce(pkce().verifier, challenge)).toBe(false);
  });
});

describe("metadados e registro", () => {
  it("anuncia endpoints, S256 e cliente público", async () => {
    const { store } = memoryStore();
    const m = JSON.parse((await call(store, "metadata", "GET")).body);
    expect(m).toMatchObject({ issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"] });
    expect(JSON.parse((await call(store, "resource", "GET")).body)).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
  });
  it("recusa registro com redirect_uri inseguro", async () => {
    const { store } = memoryStore();
    expect((await registerClient(store, "http://evil.com/cb")).res.status).toBe(400);
  });
});

describe("fluxo authorization_code + PKCE", () => {
  let ctx: ReturnType<typeof memoryStore>;
  beforeEach(() => void (ctx = memoryStore()));

  it("GET authorize mostra a página com o domínio de destino e sem aceitar iframe", async () => {
    const { client_id } = await registerClient(ctx.store);
    const r = await call(ctx.store, "authorize", "GET", {}, { response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: "S256", state: "s" });
    expect(r.status).toBe(200);
    expect(r.body).toContain("claude.ai");
    expect(r.headers["X-Frame-Options"]).toBe("DENY");
  });

  it("não redireciona para redirect_uri não registrado", async () => {
    const { client_id } = await registerClient(ctx.store);
    const r = await call(ctx.store, "authorize", "GET", {}, { response_type: "code", client_id, redirect_uri: "https://evil.com/cb", code_challenge: pkce().challenge, code_challenge_method: "S256" });
    expect(r.status).toBe(400);
    expect(r.headers.Location).toBeUndefined();
  });

  it("exige PKCE S256", async () => {
    const { client_id } = await registerClient(ctx.store);
    const r = await call(ctx.store, "authorize", "GET", {}, { response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge_method: "plain", code_challenge: "x" });
    expect(r.status).toBe(302);
    expect(new URL(r.headers.Location).searchParams.get("error")).toBe("invalid_request");
  });

  it("ciclo completo: senha → código → token → refresh com rotação", async () => {
    const { client_id } = await registerClient(ctx.store);
    const { verifier, challenge } = pkce();
    const a = await authorizeCode(ctx.store, client_id, challenge);
    expect(a.status).toBe(302);
    expect(new URL(a.headers.Location).searchParams.get("state")).toBe("xyz");
    const code = codeFrom(a.headers.Location);

    const t = await call(ctx.store, "token", "POST", { grant_type: "authorization_code", code, client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(t.status).toBe(200);
    const tok = JSON.parse(t.body);
    expect(tok).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(tok.access_token).toMatch(/^fa_oat_/);
    // só o hash é guardado
    expect(JSON.stringify(ctx.tokens)).not.toContain(tok.access_token);
    expect(JSON.stringify(ctx.tokens)).not.toContain(tok.refresh_token);

    const r = await call(ctx.store, "token", "POST", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id });
    expect(r.status).toBe(200);
    const again = await call(ctx.store, "token", "POST", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id });
    expect(again.status).toBe(400); // o refresh antigo foi rotacionado
  });

  it("código é de uso único", async () => {
    const { client_id } = await registerClient(ctx.store);
    const { verifier, challenge } = pkce();
    const code = codeFrom((await authorizeCode(ctx.store, client_id, challenge)).headers.Location);
    const body = { grant_type: "authorization_code", code, client_id, redirect_uri: REDIRECT, code_verifier: verifier };
    expect((await call(ctx.store, "token", "POST", body)).status).toBe(200);
    expect((await call(ctx.store, "token", "POST", body)).status).toBe(400);
  });

  it("recusa verifier errado, código expirado e redirect_uri diferente", async () => {
    const { client_id } = await registerClient(ctx.store);
    const { verifier, challenge } = pkce();
    const mk = async () => codeFrom((await authorizeCode(ctx.store, client_id, challenge)).headers.Location);
    const base = { grant_type: "authorization_code", client_id, redirect_uri: REDIRECT };
    expect((await call(ctx.store, "token", "POST", { ...base, code: await mk(), code_verifier: pkce().verifier })).status).toBe(400);
    expect((await call(ctx.store, "token", "POST", { ...base, code: await mk(), code_verifier: verifier }, {}, new Date(NOW.getTime() + 6 * 60_000))).status).toBe(400);
    expect((await call(ctx.store, "token", "POST", { ...base, redirect_uri: "https://claude.ai/outro", code: await mk(), code_verifier: verifier })).status).toBe(400);
  });

  it("refresh de outro cliente é recusado e não rotaciona", async () => {
    const a = await registerClient(ctx.store);
    const b = await registerClient(ctx.store);
    const { verifier, challenge } = pkce();
    const code = codeFrom((await authorizeCode(ctx.store, a.client_id, challenge)).headers.Location);
    const tok = JSON.parse((await call(ctx.store, "token", "POST", { grant_type: "authorization_code", code, client_id: a.client_id, redirect_uri: REDIRECT, code_verifier: verifier })).body);
    expect((await call(ctx.store, "token", "POST", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: b.client_id })).status).toBe(400);
    expect((await call(ctx.store, "token", "POST", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: a.client_id })).status).toBe(200);
  });

  it("senha errada: 401, e 5 erros bloqueiam por 15 min, até com a senha certa", async () => {
    const { client_id } = await registerClient(ctx.store);
    const { challenge } = pkce();
    for (let i = 0; i < 4; i++) expect((await authorizeCode(ctx.store, client_id, challenge, "errada")).status).toBe(401);
    expect((await authorizeCode(ctx.store, client_id, challenge, "errada")).status).toBe(401);
    expect(ctx.getConfig()?.locked_until).toBeTruthy();
    expect((await authorizeCode(ctx.store, client_id, challenge, "senha-do-dono")).status).toBe(429);
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect((await authorizeCode(ctx.store, client_id, challenge, "senha-do-dono", later)).status).toBe(302);
    expect(ctx.getConfig()?.failed_count).toBe(0);
  });

  it("sem senha configurada: 503, nunca emite código", async () => {
    const { client_id } = await registerClient(ctx.store);
    ctx.dropConfig();
    expect((await authorizeCode(ctx.store, client_id, pkce().challenge)).status).toBe(503);
  });
});

describe("token OAuth no /mcp", () => {
  const row = (extra: object) => ({ data: { id: "t1", access_expires_at: "2099-01-01T00:00:00Z", revoked_at: null, ...extra }, error: null });
  const fake = (r: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => r }) }) }) }) as never;

  it("aceita token válido com acesso a todas as unidades", async () => {
    expect(await authenticateMcpRequest(fake(row({})), { authorization: "Bearer fa_oat_abc" })).toEqual({ ok: true, scope: { keyId: "t1", unitIds: null } });
  });
  it("recusa expirado, revogado e desconhecido", async () => {
    expect(await authenticateMcpRequest(fake(row({ access_expires_at: "2020-01-01T00:00:00Z" })), { authorization: "Bearer fa_oat_abc" })).toMatchObject({ error: "TOKEN_EXPIRADO" });
    expect(await authenticateMcpRequest(fake(row({ revoked_at: "2026-01-01" })), { authorization: "Bearer fa_oat_abc" })).toMatchObject({ error: "CHAVE_REVOGADA" });
    expect(await authenticateMcpRequest(fake({ data: null, error: null }), { authorization: "Bearer fa_oat_abc" })).toMatchObject({ error: "CHAVE_INVALIDA" });
  });
});


describe("cliente confidencial (ex.: Gemini)", () => {
  const SECRET = "fa_cs_segredo-de-teste";
  const GOOGLE = "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-123-app_example_com";
  let ctx: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    ctx = memoryStore();
    ctx.clients.set("fa_cli_g", { client_id: "fa_cli_g", client_name: "Gemini", redirect_uris: [GOOGLE], client_secret_hash: sha256(SECRET) });
  });
  const getCode = async (challenge: string) =>
    codeFrom(
      (await call(ctx.store, "authorize", "POST", {
        response_type: "code", client_id: "fa_cli_g", redirect_uri: GOOGLE, code_challenge: challenge, code_challenge_method: "S256", state: "s", password: "senha-do-dono",
      })).headers.Location,
    );
  const exchange = (code: string, verifier: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    call(ctx.store, "token", "POST", { grant_type: "authorization_code", code, client_id: "fa_cli_g", redirect_uri: GOOGLE, code_verifier: verifier, ...extra }, {}, NOW, headers);

  it("aceita o endereço de retorno do Google na autorização", async () => {
    const r = await call(ctx.store, "authorize", "GET", {}, { response_type: "code", client_id: "fa_cli_g", redirect_uri: GOOGLE, code_challenge: pkce().challenge, code_challenge_method: "S256" });
    expect(r.status).toBe(200);
  });

  it("segredo no corpo (client_secret_post) funciona", async () => {
    const { verifier, challenge } = pkce();
    expect((await exchange(await getCode(challenge), verifier, { client_secret: SECRET })).status).toBe(200);
  });

  it("segredo no cabeçalho Basic (client_secret_basic) funciona", async () => {
    const { verifier, challenge } = pkce();
    const basic = "Basic " + Buffer.from(`${encodeURIComponent("fa_cli_g")}:${encodeURIComponent(SECRET)}`).toString("base64");
    expect((await exchange(await getCode(challenge), verifier, { client_id: undefined }, { authorization: basic })).status).toBe(200);
  });

  it("sem segredo ou com segredo errado: 401, e o código NÃO é consumido", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode(challenge);
    expect((await exchange(code, verifier)).status).toBe(401);
    expect((await exchange(code, verifier, { client_secret: "errado" })).status).toBe(401);
    expect((await exchange(code, verifier, { client_secret: SECRET })).status).toBe(200);
  });

  it("refresh também exige o segredo", async () => {
    const { verifier, challenge } = pkce();
    const tok = JSON.parse((await exchange(await getCode(challenge), verifier, { client_secret: SECRET })).body);
    const refresh = (extra: Record<string, unknown>) => call(ctx.store, "token", "POST", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: "fa_cli_g", ...extra });
    expect((await refresh({})).status).toBe(401);
    expect((await refresh({ client_secret: SECRET })).status).toBe(200);
  });

  it("cliente desconhecido: 401 invalid_client", async () => {
    const r = await call(ctx.store, "token", "POST", { grant_type: "authorization_code", client_id: "nao-existe", code: "x", redirect_uri: GOOGLE, code_verifier: pkce().verifier });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).error).toBe("invalid_client");
  });
});
